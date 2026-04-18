"""Re-extraction pipeline for edges whose type has transitioned.

When a node's static/dynamic flip causes an edge to be reclassified
(static↔dynamic↔fg_bg), the stored predicate / motion attributes are
almost certainly schema-invalid for the new edge_type. This service
runs a Gemini 3 Flash call, constrained to the new edge_type's
predicate vocabulary, over a covisible clip of the participating
tracklets, then writes the result back as an edge ``modify`` revision so
the UI picks it up through the normal refetch path.

All components live in the viz backend (no dependency on the harness
repo): clip helper in ``reextract_clip.py``, prompt builders in
``reextract_prompts.py``, predicate vocab in ``backend.core.predicate_vocab``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.core.predicate_vocab import predicate_valid_for_type
from backend.core.vsg_loader import VSGLoader
from backend.models.database import (
    EdgeRevision,
    ReextractJob,
    Video,
    async_session,
)
from backend.models.schemas import EdgeResponse
from backend.services.reextract_clip import clip_to_base64_mp4, covisible_span
from backend.services.reextract_prompts import (
    MOTION_DIRECTION,
    MOTION_TRAJECTORY,
    MOTION_VELOCITY,
    SYSTEM_PROMPT,
    build_prompt,
    predicate_set_for,
)

logger = logging.getLogger(__name__)

# Gemini video input timeout: video calls are slower than text.
GEMINI_VIDEO_TIMEOUT_S = 120.0


class ReextractService:
    """Enqueue + execute Gemini reextraction for transitioning edges."""

    def __init__(self, session: AsyncSession, video_pk: int, video_id: str):
        self.session = session
        self.video_pk = video_pk
        self.video_id = video_id

    # ------------------------------------------------------------------
    # Enqueue
    # ------------------------------------------------------------------

    async def enqueue_transitions(
        self,
        transitions: list[tuple[str, str, str]],
    ) -> list[int]:
        """Create pending jobs for each (edge_id, prev_type, new_type) tuple.

        Dedup: if a pending or running job already exists for this
        (video_pk, edge_id), skip — the existing worker will pick up the
        latest node-revision state when it runs.
        """
        if not transitions:
            return []

        created_ids: list[int] = []
        for edge_id, prev_type, new_type in transitions:
            existing = await self.session.execute(
                select(ReextractJob).where(
                    ReextractJob.video_id == self.video_pk,
                    ReextractJob.edge_id == edge_id,
                    ReextractJob.status.in_(["pending", "running"]),
                )
            )
            if existing.scalars().first() is not None:
                continue
            job = ReextractJob(
                video_id=self.video_pk,
                edge_id=edge_id,
                prev_edge_type=prev_type,
                new_edge_type=new_type,
                status="pending",
            )
            self.session.add(job)
            await self.session.flush()
            created_ids.append(job.id)
        await self.session.commit()
        return created_ids

    # ------------------------------------------------------------------
    # Worker entry points
    # ------------------------------------------------------------------

    @staticmethod
    def spawn_background(job_ids: list[int]) -> None:
        """Fire-and-forget worker for a batch of pending job ids.

        Each job runs in its own session so request-scoped sessions
        remain isolated. Exceptions are swallowed into the job row's
        ``error`` field. Must be called from within a running event loop
        (the FastAPI request handler qualifies).
        """
        if not job_ids:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        for job_id in job_ids:
            loop.create_task(ReextractService._run_in_background(job_id))

    @staticmethod
    async def _run_in_background(job_id: int) -> None:
        async with async_session() as session:
            try:
                await ReextractService._run_job(session, job_id)
            except Exception as exc:  # pragma: no cover - logged for ops
                logger.exception("reextract job %s failed: %s", job_id, exc)
                await ReextractService._mark_failed(session, job_id, repr(exc))

    @staticmethod
    async def _mark_failed(session: AsyncSession, job_id: int, error: str) -> None:
        job = await session.get(ReextractJob, job_id)
        if job is None:
            return
        job.status = "failed"
        job.error = error[:2000]
        job.completed_at = datetime.utcnow()
        await session.commit()

    # ------------------------------------------------------------------
    # Core run
    # ------------------------------------------------------------------

    @staticmethod
    async def _run_job(session: AsyncSession, job_id: int) -> None:
        job = await session.get(ReextractJob, job_id)
        if job is None:
            return
        # Claim the job — another worker shouldn't race us.
        if job.status != "pending":
            return
        job.status = "running"
        job.started_at = datetime.utcnow()
        await session.commit()

        video = await session.get(Video, job.video_id)
        if video is None:
            await ReextractService._mark_failed(session, job_id, "video missing")
            return

        try:
            loader = VSGLoader(video.vsg_path)
        except Exception as exc:
            await ReextractService._mark_failed(session, job_id, f"vsg load: {exc}")
            return

        edge = loader.get_edge_by_id(job.edge_id)
        if edge is None:
            await ReextractService._mark_failed(session, job_id, "edge missing in VSG")
            return

        # Pull the effective source/target after group-member pruning — the
        # reclassifier has already emitted the post-flip node lists via the
        # standard edge fetch, so read that path.
        from backend.core.revision_tracker import RevisionTracker
        from backend.services.annotation_service import AnnotationService

        service = AnnotationService(session, loader, video_id=video.video_id)
        effective_edges = await service.get_edges_with_revisions()
        eff_edge = next((e for e in effective_edges if e.edge_id == job.edge_id), None)
        if eff_edge is None:
            # Edge was dropped during reconciliation (e.g. all group members
            # became type-incompatible) — no reextraction possible.
            await ReextractService._mark_failed(session, job_id, "edge dropped during reclassification")
            return

        # Gather bboxes for every participating node (source + target).
        sources = eff_edge.source if isinstance(eff_edge.source, list) else [eff_edge.source]
        targets = eff_edge.target if isinstance(eff_edge.target, list) else [eff_edge.target]
        nodes_map = loader.get_all_nodes()
        bbox_lists = []
        for nid in sources + targets:
            n = nodes_map.get(nid)
            if n is None:
                continue
            bbox_lists.append(n.bboxes_by_frame)
        if not bbox_lists:
            await ReextractService._mark_failed(session, job_id, "no node bboxes available")
            return

        span = covisible_span(bbox_lists)
        if span is None:
            await ReextractService._mark_failed(session, job_id, "nodes never co-visible")
            return
        start_frame, end_frame = span

        fps = int(video.fps or 10)
        clip_b64 = await clip_to_base64_mp4(video.frames_path, start_frame, end_frame, fps)
        if clip_b64 is None:
            await ReextractService._mark_failed(session, job_id, "ffmpeg clip failed")
            return

        source_label = ReextractService._label_for(sources, eff_edge.source_category)
        target_label = ReextractService._label_for(targets, eff_edge.target_category)
        prompt = build_prompt(
            eff_edge.edge_type,
            source_label=source_label,
            target_label=target_label,
            start_frame=start_frame,
            end_frame=end_frame,
        )

        parsed = await ReextractService._call_gemini(prompt, clip_b64)
        if parsed is None:
            await ReextractService._mark_failed(session, job_id, "gemini returned no parseable JSON")
            return

        predicate = (parsed.get("predicate") or "").strip()
        if not predicate_valid_for_type(predicate, eff_edge.edge_type):
            await ReextractService._mark_failed(
                session,
                job_id,
                f"gemini predicate '{predicate}' not in {eff_edge.edge_type} vocab",
            )
            return

        attributes = ReextractService._sanitize_attributes(parsed.get("attributes"))
        if eff_edge.edge_type == "dynamic" and attributes is None:
            # Dynamic edges require motion attributes per schema; supply
            # stationary defaults if the model omitted them.
            attributes = {"velocity": "stationary", "direction": "none", "trajectory": "stable"}

        time_periods = ReextractService._sanitize_time_periods(
            parsed.get("time_periods"), start_frame, end_frame
        )
        if eff_edge.edge_type == "static":
            # Static edges span the whole video regardless of what the
            # model said.
            full = {"start_frame": 0, "end_frame": max((video.total_frames or 1) - 1, 0)}
            time_periods = [full]

        revision_id = await ReextractService._apply_result(
            session,
            video_pk=job.video_id,
            edge=eff_edge,
            predicate=predicate,
            attributes=attributes,
            time_periods=time_periods,
        )

        job.status = "done"
        job.result_predicate = predicate
        job.result_attributes = attributes
        job.result_time_periods = time_periods
        job.applied_revision_id = revision_id
        job.completed_at = datetime.utcnow()
        await session.commit()

    # ------------------------------------------------------------------
    # Gemini invocation
    # ------------------------------------------------------------------

    @staticmethod
    async def _call_gemini(prompt: str, video_b64: str) -> Optional[dict]:
        client = AsyncOpenAI(
            api_key=settings.api_key,
            base_url=settings.gemini_api_url,
            timeout=GEMINI_VIDEO_TIMEOUT_S,
        )
        try:
            resp = await client.responses.create(
                model=settings.gemini_model,
                input=[{
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": SYSTEM_PROMPT + "\n\n" + prompt},
                        {"type": "input_video",
                         "video_url": f"data:video/mp4;base64,{video_b64}"},
                    ],
                }],
                max_output_tokens=settings.gemini_max_tokens,
                temperature=0.2,
            )
        except Exception as exc:
            logger.warning("gemini call failed: %s", exc)
            return None

        text = (resp.output_text or "").strip()
        return ReextractService._extract_json(text)

    # ------------------------------------------------------------------
    # Response parsing & sanitization
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json(text: str) -> Optional[dict]:
        """Find the first JSON object in ``text`` and parse it.

        Gemini occasionally wraps JSON in prose / code fences despite the
        system prompt. We locate the outermost ``{ ... }`` block and
        attempt to parse that.
        """
        if not text:
            return None
        # Strip common fences.
        fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fenced:
            try:
                return json.loads(fenced.group(1))
            except Exception:
                pass
        # Fallback: outermost balanced braces.
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return None

    @staticmethod
    def _sanitize_attributes(attrs: Optional[dict]) -> Optional[dict]:
        if not isinstance(attrs, dict):
            return None
        velocity = attrs.get("velocity")
        direction = attrs.get("direction")
        trajectory = attrs.get("trajectory")
        if velocity not in MOTION_VELOCITY:
            velocity = None
        if direction not in MOTION_DIRECTION:
            direction = None
        if trajectory not in MOTION_TRAJECTORY:
            trajectory = None
        if not (velocity and direction and trajectory):
            return None
        return {"velocity": velocity, "direction": direction, "trajectory": trajectory}

    @staticmethod
    def _sanitize_time_periods(
        raw: object, start_frame: int, end_frame: int
    ) -> list[dict]:
        if not isinstance(raw, list) or not raw:
            return [{"start_frame": start_frame, "end_frame": end_frame}]
        out: list[dict] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                s = int(item.get("start_frame"))
                e = int(item.get("end_frame"))
            except (TypeError, ValueError):
                continue
            s = max(start_frame, min(s, end_frame))
            e = max(start_frame, min(e, end_frame))
            if e < s:
                s, e = e, s
            out.append({"start_frame": s, "end_frame": e})
        if not out:
            return [{"start_frame": start_frame, "end_frame": end_frame}]
        return out

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    @staticmethod
    async def _apply_result(
        session: AsyncSession,
        *,
        video_pk: int,
        edge: EdgeResponse,
        predicate: str,
        attributes: Optional[dict],
        time_periods: list[dict],
    ) -> int:
        """Record a modify revision on the edge with the reextracted values.

        User_id=1 (system/admin) because the revision is machine-generated.
        Downstream UI badges the revision as AI-sourced via review_notes.
        """
        from backend.models.database import User

        # Resolve a user — default to the first (admin) user.
        sys_user = await session.execute(select(User).order_by(User.id.asc()).limit(1))
        user_row = sys_user.scalars().first()
        user_id = user_row.id if user_row else 1

        original_predicate = edge.predicate
        original_attrs = (
            edge.attributes.model_dump() if edge.attributes is not None else None
        )
        original_tps = [tp.model_dump() for tp in (edge.time_periods or [edge.time_period])]

        new_source = json.dumps(edge.source) if isinstance(edge.source, list) else None
        new_target = json.dumps(edge.target) if isinstance(edge.target, list) else None
        original_source = json.dumps(edge.source) if isinstance(edge.source, list) else None
        original_target = json.dumps(edge.target) if isinstance(edge.target, list) else None

        rev = EdgeRevision(
            video_id=video_pk,
            edge_id=edge.edge_id,
            edge_type=edge.edge_type,
            user_id=user_id,
            action="modify",
            original_predicate=original_predicate,
            new_predicate=predicate,
            original_time_period=original_tps[0] if original_tps else None,
            new_time_period=time_periods[0] if time_periods else None,
            original_time_periods=original_tps,
            new_time_periods=time_periods,
            original_attributes=original_attrs,
            new_attributes=attributes,
            original_source=original_source,
            new_source=new_source,
            original_target=original_target,
            new_target=new_target,
            review_notes="auto-reextracted via Gemini on type transition",
        )
        session.add(rev)
        await session.flush()
        revision_id = rev.id
        await session.commit()
        return revision_id

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _label_for(ids: list[str], cats) -> str:
        if not ids:
            return "<unknown>"
        cats_list = cats if isinstance(cats, list) else [cats]
        pairs = []
        for i, nid in enumerate(ids):
            cat = cats_list[i] if i < len(cats_list) else "?"
            pairs.append(f"{cat} ({nid})")
        return ", ".join(pairs)
