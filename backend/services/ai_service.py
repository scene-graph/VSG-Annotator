"""AI Service for attribute suggestions using Kimi 2.5 model."""

import asyncio
import base64
import io
import json
import logging
import re
from pathlib import Path
from typing import Dict, Optional, Any, Tuple

import requests
from PIL import Image

from backend.config import settings
from backend.core.schema_validator import SchemaValidator
from backend.services.video_service import get_frame_for_video

logger = logging.getLogger(__name__)

# Schema-defined attribute values
COLOR_VALUES = [
    "white", "black", "gray", "brown", "beige", "tan", "red", "orange",
    "yellow", "green", "blue", "purple", "pink", "gold", "silver",
    "copper", "bronze", "light", "dark", "varied", "multicolor", "transparent"
]

TEXTURE_VALUES = [
    "smooth", "rough", "soft", "hard", "fuzzy", "fluffy", "woven",
    "knitted", "glossy", "matte", "grainy", "bumpy", "wrinkled",
    "crinkled", "patterned"
]

MATERIAL_VALUES = [
    "wood", "metal", "plastic", "glass", "ceramic", "stone", "concrete",
    "fabric", "leather", "cloth", "foam", "rubber", "paper", "cardboard",
    "skin", "hair", "fur"
]

SIZE_VALUES = ["tiny", "small", "medium", "large", "huge", "normal"]

SHAPE_VALUES = [
    "rectangular", "square", "triangular", "oval", "circular", "flat",
    "cylindrical", "spherical", "box-shaped", "humanoid", "hand-shaped",
    "irregular", "elongated", "round"
]

AGE_VALUES = ["child", "youth", "middle-age", "old", "unknown"]

PERSON_CATEGORIES = {"person", "adult", "child", "baby"}
DEFAULT_DYNAMIC_MOTION = {
    "velocity": "moderate",
    "direction": "none",
    "trajectory": "curved",
}


def extract_message_content(result: Dict[str, Any]) -> tuple[Optional[str], Dict[str, Any]]:
    """
    Extract message content from Kimi response, handling string or list content.

    Returns:
        content: Extracted text content or None
        meta: Metadata about extraction (content_type, content_length)
    """
    meta: Dict[str, Any] = {"content_type": None, "content_length": None, "content_source": None}
    try:
        choices = result.get("choices", [])
        if not choices:
            return None, meta

        message = choices[0].get("message", {})
        content = message.get("content")
        meta["content_type"] = type(content).__name__

        if isinstance(content, str):
            if content.strip():
                meta["content_length"] = len(content)
                meta["content_source"] = "content"
                return content, meta

        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str):
                        parts.append(text)
                elif isinstance(part, str):
                    parts.append(part)
            combined = "".join(parts).strip()
            meta["content_length"] = len(combined)
            if combined:
                meta["content_source"] = "content"
                return combined, meta

        for fallback_key in ("reasoning_content", "reasoning"):
            fallback = message.get(fallback_key)
            if isinstance(fallback, str) and fallback.strip():
                meta["content_type"] = type(fallback).__name__
                meta["content_length"] = len(fallback.strip())
                meta["content_source"] = fallback_key
                return fallback.strip(), meta

        return None, meta
    except Exception:
        return None, meta


def extract_last_json_object(text: str) -> Optional[str]:
    """
    Extract the last balanced JSON object substring from text.
    """
    start = None
    depth = 0
    last_obj = None
    for idx, char in enumerate(text):
        if char == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    last_obj = text[start:idx + 1]
                    start = None
    return last_obj


def _matches_option(text: str, option: str) -> bool:
    pattern = rf"(?<![a-z0-9-]){re.escape(option)}(?![a-z0-9-])"
    return re.search(pattern, text) is not None


def _find_value_for_label(text: str, label: str, options: list[str]) -> Optional[str]:
    lowered = text.lower()
    segments = [seg.strip() for seg in re.split(r"[\n\r]+", lowered) if seg.strip()]
    candidates: list[str] = []
    for segment in segments:
        if label in segment:
            for option in options:
                if _matches_option(segment, option):
                    candidates.append(option)
    if candidates:
        return candidates[-1]
    for option in options:
        if _matches_option(lowered, option):
            return option
    return None


def infer_attributes_from_text(text: str) -> Optional[Dict[str, Any]]:
    """
    Best-effort extraction of attributes from free-form text.
    """
    color = _find_value_for_label(text, "color", COLOR_VALUES)
    texture = _find_value_for_label(text, "texture", TEXTURE_VALUES)
    material = _find_value_for_label(text, "material", MATERIAL_VALUES)
    size = _find_value_for_label(text, "size", SIZE_VALUES)
    shape = _find_value_for_label(text, "shape", SHAPE_VALUES)
    age = _find_value_for_label(text, "age", AGE_VALUES)

    if not any([color, texture, material, size, shape, age]):
        return None

    result: Dict[str, Any] = {
        "visual": {
            "color": color or "unknown",
            "texture": texture or "unknown",
            "material": material or "unknown",
        },
        "physical": {},
        "confidence": 0.2,
    }

    if age:
        result["physical"]["age"] = age
    else:
        result["physical"]["size"] = size or "medium"
        result["physical"]["shape"] = shape or "irregular"

    return result


def extract_gemini_content(result: Dict[str, Any]) -> Tuple[Optional[str], Dict[str, Any]]:
    """
    Extract text content from Gemini response.

    Returns:
        content: Extracted text or None
        meta: Metadata about extraction (content_type, content_length)
    """
    meta: Dict[str, Any] = {"content_type": None, "content_length": None}
    try:
        candidates = result.get("candidates", [])
        if not candidates:
            return None, meta

        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        texts: list[str] = []
        for part in parts:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    texts.append(text)
        combined = "".join(texts).strip()
        meta["content_type"] = "text"
        meta["content_length"] = len(combined)
        return combined if combined else None, meta
    except Exception:
        return None, meta


def _get_ai_timeout() -> tuple[float, float]:
    # requests supports (connect_timeout, read_timeout)
    return (settings.ai_http_connect_timeout_s, settings.ai_http_read_timeout_s)


async def post_with_timeout(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> requests.Response:
    """Send a single provider request with bounded timeout without blocking event loop."""
    timeout = _get_ai_timeout()
    logger.info(
        "AI request timeout config: connect=%.1fs read=%.1fs",
        settings.ai_http_connect_timeout_s,
        settings.ai_http_read_timeout_s,
    )
    try:
        return await asyncio.to_thread(
            requests.post,
            url,
            headers=headers,
            json=payload,
            timeout=timeout,
        )
    except asyncio.CancelledError:
        logger.info("AI provider request cancelled before completion")
        raise
    except requests.exceptions.Timeout as e:
        logger.warning("AI provider timeout: %s", e)
        raise ValueError(
            f"AI provider timeout (read timeout {settings.ai_http_read_timeout_s}s)"
        ) from e
    except requests.exceptions.RequestException as e:
        logger.error("AI provider request error: %s", e)
        raise ValueError(f"AI provider request failed: {e}") from e


def crop_bbox_from_frame(frame_path: Path, bbox: dict, padding: int = 10) -> Image.Image:
    """
    Crop bounding box region from frame with optional padding.

    Args:
        frame_path: Path to the frame image
        bbox: Bounding box dict with keys: left, top, width, height
        padding: Pixels to add around bbox for context
    """
    with Image.open(frame_path) as img:
        # Get image dimensions
        img_width, img_height = img.size

        # Calculate crop coordinates with padding
        left = max(0, bbox['left'] - padding)
        top = max(0, bbox['top'] - padding)
        right = min(img_width, bbox['left'] + bbox['width'] + padding)
        bottom = min(img_height, bbox['top'] + bbox['height'] + padding)

        # Crop and return
        return img.crop((left, top, right, bottom))


def encode_image_base64(image: Image.Image, quality: int = 85) -> str:
    """
    Encode PIL Image as base64 JPEG string.

    Args:
        image: PIL Image object
        quality: JPEG quality (1-100)
    """
    # Convert RGBA to RGB if needed
    if image.mode in ('RGBA', 'P'):
        rgb_img = Image.new('RGB', image.size, (255, 255, 255))
        rgb_img.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
        image = rgb_img

    # Encode to base64
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode('utf-8')


def build_attribute_prompt(category: str, frame_idx: int) -> str:
    """
    Build the prompt for Kimi to analyze object attributes.

    Args:
        category: Object category (e.g., "person", "chair", "car")
        frame_idx: Current frame number
    """
    category_lower = category.lower().strip()
    is_person = category_lower in PERSON_CATEGORIES
    physical_section = (
        f"- age: Choose ONE from: {', '.join(AGE_VALUES)}"
        if is_person
        else f"- size: Choose ONE from: {', '.join(SIZE_VALUES)}\n- shape: Choose ONE from: {', '.join(SHAPE_VALUES)}"
    )
    physical_json = (
        '  "physical": {\n    "age": "selected_age"\n  }'
        if is_person
        else '  "physical": {\n    "size": "selected_size",\n    "shape": "selected_shape"\n  }'
    )

    prompt = f"""You are analyzing an object in a video frame. Based on the cropped image provided, determine the visual and physical attributes of the object.

Object Category: {category}
Frame Number: {frame_idx}

Please analyze the object and provide attribute values using ONLY the following options:

VISUAL ATTRIBUTES:
- color: Choose ONE from: {', '.join(COLOR_VALUES)}
- texture: Choose ONE from: {', '.join(TEXTURE_VALUES)}
- material: Choose ONE from: {', '.join(MATERIAL_VALUES)}

PHYSICAL ATTRIBUTES:
{physical_section}

Important instructions:
1. Select ONLY from the provided options above
2. Choose the MOST appropriate single value for each attribute
3. Base your analysis on what is visible in the image
4. If uncertain, choose the closest matching option
5. Do not include reasoning or explanations. Output JSON only.

Respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{{
  "visual": {{
    "color": "selected_color",
    "texture": "selected_texture",
    "material": "selected_material"
  }},
{physical_json},
  "confidence": 0.85
}}

The confidence should be a number between 0.0 and 1.0 indicating how confident you are in your analysis."""

    return prompt


async def suggest_node_attributes(
    video_id: str,
    node: Dict[str, Any],
    frame_idx: int,
    frames_path: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    debug_mode: bool = False
) -> Dict[str, Any]:
    """
    Get AI-suggested attributes for a node using Kimi 2.5.

    Args:
        video_id: Video identifier
        node: Node object with bboxes_by_frame
        frame_idx: Frame index to analyze
        frames_path: Base path to video frames
        debug_mode: If True, include debug information

    Returns:
        Dict with suggested visual and physical attributes
    """
    debug_info = {}
    result: Optional[Dict[str, Any]] = None
    response_content: Optional[str] = None
    provider_name = (provider or settings.ai_default_provider).lower()
    model_name = model

    try:
        # Check if API key is configured
        if provider_name == "kimi":
            api_key = settings.nvidia_api_key or settings.kimi_api_key
            if not api_key:
                raise ValueError("NVIDIA_API_KEY or KIMI_API_KEY not configured in environment")
            key_source = "nvidia" if settings.nvidia_api_key else "kimi"
            model_name = model_name or settings.kimi_model
        elif provider_name == "openai":
            if not settings.openai_api_key:
                raise ValueError("OPENAI_API_KEY not configured in environment")
            model_name = model_name or settings.openai_model
        elif provider_name == "gemini":
            if not settings.gemini_api_key:
                raise ValueError("GEMINI_API_KEY not configured in environment")
            model_name = model_name or settings.gemini_model
        else:
            raise ValueError(f"Unsupported AI provider: {provider_name}")

        # Try to find the correct frame path
        frame_path = None
        attempted_paths = []

        # First try the given frames_path
        attempt1 = get_frame_for_video(video_id, frames_path, frame_idx)
        attempted_paths.append(str(attempt1))
        if attempt1 and attempt1.exists():
            frame_path = attempt1
        else:
            # Try swapping pvsg_mid and pvsg_mini
            if 'pvsg_mid' in frames_path:
                frames_path_alt = frames_path.replace('pvsg_mid', 'pvsg_mini')
                attempt2 = get_frame_for_video(video_id, frames_path_alt, frame_idx)
                attempted_paths.append(str(attempt2))
                if attempt2 and attempt2.exists():
                    frame_path = attempt2
            elif 'pvsg_mini' in frames_path:
                frames_path_alt = frames_path.replace('pvsg_mini', 'pvsg_mid')
                attempt3 = get_frame_for_video(video_id, frames_path_alt, frame_idx)
                attempted_paths.append(str(attempt3))
                if attempt3 and attempt3.exists():
                    frame_path = attempt3

        debug_info['frame_path_attempted'] = attempted_paths
        debug_info['frame_exists'] = frame_path is not None and frame_path.exists()

        if not frame_path or not frame_path.exists():
            error_msg = f"Frame {frame_idx} not found for video {video_id}. Tried: {', '.join(attempted_paths)}"
            debug_info['error_details'] = error_msg
            raise ValueError(error_msg)

        # Get bounding box for this frame
        bbox_key = str(frame_idx)
        # Bounding boxes are stored in node['tracking']['bboxes_by_frame']
        bboxes = node.get('tracking', {}).get('bboxes_by_frame', {})
        if bbox_key not in bboxes:
            # Get the valid frame range for this node
            frame_numbers = sorted([int(k) for k in bboxes.keys()])
            if frame_numbers:
                min_frame = frame_numbers[0]
                max_frame = frame_numbers[-1]
                raise ValueError(f"Node {node.get('node_id')} not visible at frame {frame_idx}. Node is visible in frames {min_frame}-{max_frame}")
            else:
                raise ValueError(f"Node {node.get('node_id')} has no bounding boxes defined")

        bbox = node['tracking']['bboxes_by_frame'][bbox_key]
        debug_info['bbox_used'] = bbox

        # Crop and encode image
        cropped_image = crop_bbox_from_frame(frame_path, bbox)

        # Resize if too large (Kimi handles better with reasonable sizes)
        max_dimension = 512  # Reduced from 800 to 512 for faster processing
        if max(cropped_image.size) > max_dimension:
            cropped_image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

        image_b64 = encode_image_base64(cropped_image)

        # Build prompt
        category = node.get('category', 'unknown')
        prompt = build_attribute_prompt(category, frame_idx)
        debug_info['provider'] = provider_name
        debug_info['model'] = model_name
        if provider_name == "kimi":
            debug_info['key_source'] = key_source

        # Prepare request based on provider
        if provider_name == "kimi":
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "model": model_name,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}"
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": settings.kimi_max_tokens,
                "temperature": settings.kimi_temperature,
                "stream": False
            }

            if settings.kimi_enable_thinking:
                payload["extra_body"] = {"thinking": True}

            api_url = settings.kimi_api_url
        elif provider_name == "openai":
            headers = {
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "model": model_name,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}"
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": settings.openai_max_tokens,
                "temperature": settings.openai_temperature
            }
            api_url = settings.openai_api_url
        else:
            headers = {
                "Content-Type": "application/json",
                "x-goog-api-key": settings.gemini_api_key
            }
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": "image/jpeg",
                                    "data": image_b64
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "maxOutputTokens": settings.gemini_max_tokens,
                    "temperature": settings.gemini_temperature
                }
            }
            base_url = settings.gemini_api_url.rstrip("/")
            if ":generateContent" in base_url:
                api_url = base_url
            else:
                api_url = f"{base_url}/{model_name}:generateContent"

        # Log image size and request details
        logger.info(f"Calling {provider_name} API for node {node.get('node_id')} at frame {frame_idx}")
        logger.info(f"Image size: {cropped_image.size}, Base64 length: {len(image_b64)}")
        logger.info(f"API URL: {api_url}")
        logger.info(f"Model: {model_name}")

        response = await post_with_timeout(api_url, headers, payload)

        # Check response
        if response.status_code != 200:
            logger.error(f"Kimi API error: {response.status_code} - {response.text}")
            raise ValueError(f"API request failed with status {response.status_code}")

        # Parse response
        result = response.json()
        response_meta: Dict[str, Any] = {}

        # Extract content from response
        if provider_name in ("kimi", "openai"):
            if 'choices' not in result or len(result['choices']) == 0:
                raise ValueError("No response from AI API")
            response_content, response_meta = extract_message_content(result)
            finish_reason = result.get("choices", [{}])[0].get("finish_reason")
            response_meta["finish_reason"] = finish_reason
        else:
            response_content, response_meta = extract_gemini_content(result)
        debug_info['response_meta'] = response_meta
        debug_info['response_content_present'] = bool(response_content)
        debug_info['content_source'] = response_meta.get("content_source")

        # Parse JSON from content
        # Remove any markdown code blocks if present
        if not response_content or not response_content.strip():
            raise ValueError("AI response content is empty")

        content = response_content.strip()
        if content.startswith("```"):
            parts = content.split("```")
            if len(parts) > 1:
                content = parts[1]
            if content.startswith("json"):
                content = content[4:]
        if content.endswith("```"):
            content = content[:-3]

        try:
            suggestions = json.loads(content.strip())
        except json.JSONDecodeError as e:
            candidate = extract_last_json_object(content)
            if candidate:
                try:
                    suggestions = json.loads(candidate)
                except json.JSONDecodeError:
                    suggestions = None
            else:
                suggestions = None
            if suggestions is None:
                inferred = infer_attributes_from_text(content)
                if inferred:
                    suggestions = inferred
                    debug_info["heuristic_extraction"] = True
                else:
                    logger.error(f"Failed to parse Kimi response as JSON: {content}")
                    raise ValueError(f"Invalid JSON response from AI: {e}")

        # Validate that all required fields are present
        if 'visual' not in suggestions or 'physical' not in suggestions:
            raise ValueError("AI response missing required fields")

        # Validate that values are from allowed options
        visual = suggestions['visual']
        physical = suggestions['physical']
        is_person = category.lower().strip() in PERSON_CATEGORIES

        # Validate and correct values if needed
        if visual.get('color') not in COLOR_VALUES:
            visual['color'] = 'unknown'
        if visual.get('texture') not in TEXTURE_VALUES:
            visual['texture'] = 'unknown'
        if visual.get('material') not in MATERIAL_VALUES:
            visual['material'] = 'unknown'
        if is_person:
            if physical.get('age') not in AGE_VALUES:
                physical['age'] = 'unknown'
            physical.pop('size', None)
            physical.pop('shape', None)
        else:
            if physical.get('size') not in SIZE_VALUES:
                physical['size'] = 'medium'
            if physical.get('shape') not in SHAPE_VALUES:
                physical['shape'] = 'irregular'
            physical.pop('age', None)

        # Add metadata
        suggestions['node_id'] = node.get('node_id')
        suggestions['frame_idx'] = frame_idx
        suggestions['category'] = category

        # Add debug info if requested
        if debug_mode:
            suggestions['debug_info'] = debug_info
            suggestions['cropped_image'] = image_b64
            suggestions['raw_request'] = {
                "provider": provider_name,
                "model": model_name,
                "temperature": settings.kimi_temperature if provider_name == "kimi"
                else settings.openai_temperature if provider_name == "openai"
                else settings.gemini_temperature,
                "max_tokens": settings.kimi_max_tokens if provider_name == "kimi"
                else settings.openai_max_tokens if provider_name == "openai"
                else settings.gemini_max_tokens,
                "prompt": prompt[:500] + "..." if len(prompt) > 500 else prompt,
                "image_size": cropped_image.size
            }
            suggestions['raw_response'] = result
            suggestions['response_content'] = response_content

        logger.info(f"Successfully got AI suggestions for node {node.get('node_id')}")

        return suggestions

    except asyncio.CancelledError:
        logger.info(
            "Node AI suggestion cancelled: video=%s node=%s frame=%s",
            video_id,
            node.get("node_id"),
            frame_idx,
        )
        raise
    except Exception as e:
        logger.error(f"Error getting AI suggestions: {str(e)}")
        # Return default/fallback suggestions
        is_person = node.get('category', '').lower().strip() in PERSON_CATEGORIES
        error_result = {
            "visual": {
                "color": "unknown",
                "texture": "unknown",
                "material": "unknown"
            },
            "physical": (
                {"age": "unknown"} if is_person else {"size": "medium", "shape": "irregular"}
            ),
            "confidence": 0.0,
            "error": str(e),
            "node_id": node.get('node_id'),
            "frame_idx": frame_idx,
            "category": node.get('category', 'unknown')
        }

        # Add debug info even on error
        if debug_mode:
            error_result['debug_info'] = debug_info
            if response_content:
                error_result['response_content'] = response_content
            if result is not None:
                error_result['raw_response'] = result

        return error_result


def _clamp(value: int, lower: int, upper: int) -> int:
    return max(lower, min(value, upper))


def _to_single_node_id(value: Any, field_name: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], str):
        return value[0]
    raise ValueError(f"Edge field '{field_name}' must contain a single node ID")


def _bbox_for_frame(node: Dict[str, Any], frame_idx: int) -> Optional[Dict[str, int]]:
    bboxes = node.get("bboxes_by_frame", {})
    bbox = bboxes.get(str(frame_idx))
    if not isinstance(bbox, dict):
        return None
    required = ("left", "top", "width", "height")
    if not all(k in bbox for k in required):
        return None
    return {
        "left": int(bbox["left"]),
        "top": int(bbox["top"]),
        "width": int(bbox["width"]),
        "height": int(bbox["height"]),
    }


def _visible_frames(node: Dict[str, Any], total_frames: int) -> set[int]:
    frames: set[int] = set()
    for key in node.get("bboxes_by_frame", {}).keys():
        try:
            frame = int(key)
        except (TypeError, ValueError):
            continue
        if 0 <= frame < total_frames:
            frames.add(frame)
    return frames


def _overlap_window(
    source_node: Dict[str, Any],
    target_node: Dict[str, Any],
    total_frames: int,
) -> Optional[Tuple[int, int]]:
    source_frames = _visible_frames(source_node, total_frames)
    target_frames = _visible_frames(target_node, total_frames)
    overlap = sorted(source_frames.intersection(target_frames))
    if not overlap:
        return None
    return overlap[0], overlap[-1]


def _choose_context_frames(
    center: int,
    lower: int,
    upper: int,
    desired_count: int = 3,
) -> list[int]:
    picks: list[int] = []
    seen: set[int] = set()

    for candidate in (_clamp(center - 3, lower, upper), center, _clamp(center + 3, lower, upper)):
        if candidate not in seen:
            picks.append(candidate)
            seen.add(candidate)

    delta = 1
    while len(picks) < desired_count and (center - delta >= lower or center + delta <= upper):
        for candidate in (center - delta, center + delta):
            if lower <= candidate <= upper and candidate not in seen:
                picks.append(candidate)
                seen.add(candidate)
                if len(picks) >= desired_count:
                    break
        delta += 1

    return sorted(picks[:desired_count])


def _crop_relation_region(
    frame_path: Path,
    source_bbox: Optional[Dict[str, int]],
    target_bbox: Optional[Dict[str, int]],
    padding: int = 20,
) -> Image.Image:
    with Image.open(frame_path) as img:
        img_width, img_height = img.size
        boxes = [b for b in (source_bbox, target_bbox) if b is not None]
        if not boxes:
            return img.copy()

        left = min(box["left"] for box in boxes)
        top = min(box["top"] for box in boxes)
        right = max(box["left"] + box["width"] for box in boxes)
        bottom = max(box["top"] + box["height"] for box in boxes)

        crop_left = max(0, left - padding)
        crop_top = max(0, top - padding)
        crop_right = min(img_width, right + padding)
        crop_bottom = min(img_height, bottom + padding)

        return img.crop((crop_left, crop_top, crop_right, crop_bottom))


def _as_category_text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _build_edge_prompt(
    edge: Dict[str, Any],
    edge_type: str,
    valid_predicates: list[str],
    motion_values: Dict[str, list[str]],
    context_frames: list[int],
    time_period: Dict[str, int],
) -> str:
    source_category = _as_category_text(edge.get("source_category", "unknown"))
    target_category = _as_category_text(edge.get("target_category", "unknown"))
    predicates = ", ".join(valid_predicates)

    if edge_type == "dynamic":
        return f"""You are annotating a dynamic object-object edge in a video scene graph.

Edge Type: dynamic
Source Category: {source_category}
Target Category: {target_category}
Context Frames: {context_frames}
Deterministic valid timeline: {time_period["start_frame"]}-{time_period["end_frame"]} (fixed, do not change)

Choose a predicate and motion attributes from these exact options.
Valid dynamic predicates: {predicates}
velocity options: {", ".join(motion_values["velocity"])}
direction options: {", ".join(motion_values["direction"])}
trajectory options: {", ".join(motion_values["trajectory"])}

Important instructions:
1. Return JSON only, no markdown and no explanation.
2. Use only the listed values.
3. Focus on motion between source and target using all provided frames.

Output exactly:
{{
  "predicate": "one_valid_dynamic_predicate",
  "attributes": {{
    "velocity": "one_valid_velocity",
    "direction": "one_valid_direction",
    "trajectory": "one_valid_trajectory"
  }},
  "confidence": 0.85
}}"""

    if edge_type == "fg_bg":
        return f"""You are annotating a foreground-background edge in a video scene graph.

Edge Type: fg_bg
Foreground Category: {source_category}
Background Category: {target_category}
Context Frames: {context_frames}
Timeline is fixed to full video: {time_period["start_frame"]}-{time_period["end_frame"]}

Choose a predicate from these exact options:
{predicates}

Important instructions:
1. Return JSON only, no markdown and no explanation.
2. Use only the listed values.
3. Focus on spatial foreground-background relation.

Output exactly:
{{
  "predicate": "one_valid_fg_bg_predicate",
  "confidence": 0.85
}}"""

    return f"""You are annotating a static object-object edge in a video scene graph.

Edge Type: static
Source Category: {source_category}
Target Category: {target_category}
Context Frames: {context_frames}
Timeline is fixed to full video: {time_period["start_frame"]}-{time_period["end_frame"]}

Choose a predicate from these exact options:
{predicates}

Important instructions:
1. Return JSON only, no markdown and no explanation.
2. Use only the listed values.

Output exactly:
{{
  "predicate": "one_valid_static_predicate",
  "confidence": 0.85
}}"""


def _strip_markdown_json(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) > 1:
            text = parts[1]
        if text.startswith("json"):
            text = text[4:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _parse_edge_response_json(content: str) -> Dict[str, Any]:
    stripped = _strip_markdown_json(content)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        candidate = extract_last_json_object(stripped)
        if candidate is None:
            raise
        return json.loads(candidate)


async def suggest_edge_annotation(
    video_id: str,
    edge: Dict[str, Any],
    frame_idx: int,
    frames_path: str,
    nodes_by_id: Dict[str, Dict[str, Any]],
    total_frames: int,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    debug_mode: bool = False,
) -> Dict[str, Any]:
    """Get AI suggestions for edge predicate/motion attributes."""
    debug_info: Dict[str, Any] = {}
    result: Optional[Dict[str, Any]] = None
    response_content: Optional[str] = None
    context_images: list[str] = []
    provider_name = (provider or settings.ai_default_provider).lower()
    model_name = model

    edge_id = str(edge.get("edge_id", "unknown"))
    edge_type = str(edge.get("edge_type", "unknown"))
    motion_values = SchemaValidator.get_valid_motion_values()
    valid_predicates = SchemaValidator.get_valid_predicates(edge_type)

    fallback_time_periods = edge.get("time_periods")
    if not isinstance(fallback_time_periods, list) or not fallback_time_periods:
        fallback_single_tp = edge.get("time_period")
        if isinstance(fallback_single_tp, dict):
            fallback_time_periods = [fallback_single_tp]
        else:
            fallback_time_periods = [{
                "start_frame": 0,
                "end_frame": max(total_frames - 1, 0),
            }]
    fallback_predicate = str(edge.get("predicate", ""))
    fallback_attrs = edge.get("attributes") or DEFAULT_DYNAMIC_MOTION.copy()

    try:
        if provider_name == "kimi":
            api_key = settings.nvidia_api_key or settings.kimi_api_key
            if not api_key:
                raise ValueError("NVIDIA_API_KEY or KIMI_API_KEY not configured in environment")
            model_name = model_name or settings.kimi_model
            api_url = settings.kimi_api_url
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        elif provider_name == "openai":
            if not settings.openai_api_key:
                raise ValueError("OPENAI_API_KEY not configured in environment")
            model_name = model_name or settings.openai_model
            api_url = settings.openai_api_url
            headers = {
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        elif provider_name == "gemini":
            if not settings.gemini_api_key:
                raise ValueError("GEMINI_API_KEY not configured in environment")
            model_name = model_name or settings.gemini_model
            base_url = settings.gemini_api_url.rstrip("/")
            api_url = base_url if ":generateContent" in base_url else f"{base_url}/{model_name}:generateContent"
            headers = {
                "Content-Type": "application/json",
                "x-goog-api-key": settings.gemini_api_key,
            }
        else:
            raise ValueError(f"Unsupported AI provider: {provider_name}")

        if total_frames <= 0:
            raise ValueError("Video total_frames must be positive")

        if edge_type == "dynamic":
            source_id = _to_single_node_id(edge.get("source"), "source")
            target_id = _to_single_node_id(edge.get("target"), "target")
            source_node = nodes_by_id.get(source_id)
            target_node = nodes_by_id.get(target_id)
            if source_node is None or target_node is None:
                raise ValueError(f"Source/target nodes not found for dynamic edge {edge_id}")

            overlap = _overlap_window(source_node, target_node, total_frames)
            if overlap is None:
                raise ValueError(
                    f"Dynamic edge {edge_id} has no frame where both source/target are visible"
                )
            valid_start, valid_end = overlap
            resolved_frame = _clamp(frame_idx, valid_start, valid_end)
            context_frames = _choose_context_frames(resolved_frame, valid_start, valid_end, desired_count=3)
            time_periods = [{"start_frame": valid_start, "end_frame": valid_end}]
            debug_info["source_node_id"] = source_id
            debug_info["target_node_id"] = target_id
        else:
            valid_start, valid_end = 0, max(total_frames - 1, 0)
            resolved_frame = _clamp(frame_idx, valid_start, valid_end)
            context_frames = [resolved_frame]
            time_periods = [{"start_frame": valid_start, "end_frame": valid_end}]
            source_node = None
            target_node = None

        image_b64_list: list[str] = []
        frame_paths_used: list[str] = []
        for frame in context_frames:
            frame_path = get_frame_for_video(video_id, frames_path, frame)
            if frame_path is None or not frame_path.exists():
                raise ValueError(f"Frame {frame} not found for video {video_id}")

            source_bbox = _bbox_for_frame(source_node, frame) if source_node else None
            target_bbox = _bbox_for_frame(target_node, frame) if target_node else None
            cropped = _crop_relation_region(frame_path, source_bbox, target_bbox)
            if max(cropped.size) > 640:
                cropped.thumbnail((640, 640), Image.Resampling.LANCZOS)
            image_b64_list.append(encode_image_base64(cropped))
            frame_paths_used.append(str(frame_path))
        context_images = image_b64_list[:]

        debug_info["context_frames"] = context_frames
        debug_info["resolved_frame_idx"] = resolved_frame
        debug_info["time_period"] = time_periods[0]
        debug_info["frame_paths_used"] = frame_paths_used
        debug_info["provider"] = provider_name
        debug_info["model"] = model_name

        prompt = _build_edge_prompt(
            edge=edge,
            edge_type=edge_type,
            valid_predicates=valid_predicates,
            motion_values=motion_values,
            context_frames=context_frames,
            time_period=time_periods[0],
        )

        if provider_name in ("kimi", "openai"):
            content = [{"type": "text", "text": prompt}]
            content.extend([
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                for img_b64 in image_b64_list
            ])
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": (
                    settings.kimi_max_tokens if provider_name == "kimi"
                    else settings.openai_max_tokens
                ),
                "temperature": (
                    settings.kimi_temperature if provider_name == "kimi"
                    else settings.openai_temperature
                ),
            }
            if provider_name == "kimi":
                payload["stream"] = False
                if settings.kimi_enable_thinking:
                    payload["extra_body"] = {"thinking": True}
        else:
            parts: list[Dict[str, Any]] = [{"text": prompt}]
            parts.extend([
                {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}}
                for img_b64 in image_b64_list
            ])
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "maxOutputTokens": settings.gemini_max_tokens,
                    "temperature": settings.gemini_temperature,
                },
            }

        response = await post_with_timeout(api_url, headers, payload)
        if response.status_code != 200:
            raise ValueError(f"API request failed with status {response.status_code}")

        result = response.json()
        if provider_name in ("kimi", "openai"):
            response_content, response_meta = extract_message_content(result)
        else:
            response_content, response_meta = extract_gemini_content(result)
        debug_info["response_meta"] = response_meta

        if not response_content or not response_content.strip():
            raise ValueError("AI response content is empty")

        parsed = _parse_edge_response_json(response_content)

        predicate = str(parsed.get("predicate", fallback_predicate))
        if predicate not in valid_predicates:
            predicate = fallback_predicate

        confidence_raw = parsed.get("confidence", 0.0)
        try:
            confidence = max(0.0, min(1.0, float(confidence_raw)))
        except (TypeError, ValueError):
            confidence = 0.0

        response_payload: Dict[str, Any] = {
            "edge_id": edge_id,
            "edge_type": edge_type,
            "predicate": predicate,
            "time_periods": time_periods,
            "confidence": confidence,
            "resolved_frame_idx": resolved_frame,
            "context_frames": context_frames,
        }

        if edge_type == "dynamic":
            raw_attrs = parsed.get("attributes", {})
            if not isinstance(raw_attrs, dict):
                raw_attrs = {}
            velocity = raw_attrs.get("velocity", fallback_attrs.get("velocity", DEFAULT_DYNAMIC_MOTION["velocity"]))
            direction = raw_attrs.get("direction", fallback_attrs.get("direction", DEFAULT_DYNAMIC_MOTION["direction"]))
            trajectory = raw_attrs.get("trajectory", fallback_attrs.get("trajectory", DEFAULT_DYNAMIC_MOTION["trajectory"]))

            if velocity not in motion_values["velocity"]:
                velocity = fallback_attrs.get("velocity", DEFAULT_DYNAMIC_MOTION["velocity"])
            if direction not in motion_values["direction"]:
                direction = fallback_attrs.get("direction", DEFAULT_DYNAMIC_MOTION["direction"])
            if trajectory not in motion_values["trajectory"]:
                trajectory = fallback_attrs.get("trajectory", DEFAULT_DYNAMIC_MOTION["trajectory"])

            response_payload["attributes"] = {
                "velocity": velocity,
                "direction": direction,
                "trajectory": trajectory,
            }

        if debug_mode:
            response_payload["debug_info"] = debug_info
            response_payload["context_images"] = context_images
            response_payload["raw_request"] = {
                "provider": provider_name,
                "model": model_name,
                "prompt": prompt[:500] + "..." if len(prompt) > 500 else prompt,
                "context_frames": context_frames,
                "frame_paths_used": frame_paths_used,
            }
            response_payload["raw_response"] = result
            response_payload["response_content"] = response_content

        return response_payload

    except asyncio.CancelledError:
        logger.info(
            "Edge AI suggestion cancelled: video=%s edge=%s frame=%s",
            video_id,
            edge_id,
            frame_idx,
        )
        raise
    except Exception as e:
        logger.error("Error getting edge AI suggestions: %s", str(e))
        error_payload: Dict[str, Any] = {
            "edge_id": edge_id,
            "edge_type": edge_type,
            "predicate": fallback_predicate,
            "time_periods": fallback_time_periods,
            "confidence": 0.0,
            "error": str(e),
        }
        if edge_type == "dynamic":
            error_payload["attributes"] = {
                "velocity": fallback_attrs.get("velocity", DEFAULT_DYNAMIC_MOTION["velocity"]),
                "direction": fallback_attrs.get("direction", DEFAULT_DYNAMIC_MOTION["direction"]),
                "trajectory": fallback_attrs.get("trajectory", DEFAULT_DYNAMIC_MOTION["trajectory"]),
            }
        if debug_mode:
            error_payload["debug_info"] = debug_info
            if context_images:
                error_payload["context_images"] = context_images
            if response_content:
                error_payload["response_content"] = response_content
            if result is not None:
                error_payload["raw_response"] = result
        return error_payload
