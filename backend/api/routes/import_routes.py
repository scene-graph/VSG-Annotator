"""Import routes for importing VSG files."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.database import Video, get_db
from backend.models.schemas import ImportResponse
from backend.services.import_service import ImportService, VSGValidationError

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/{video_id}", response_model=ImportResponse)
async def import_vsg(
    video_id: str,
    file: UploadFile = File(...),
    user_id: int = Query(..., description="User ID performing the import"),
    clear_revisions: bool = Query(
        True, description="Clear all existing revisions"
    ),
    db: AsyncSession = Depends(get_db),
) -> ImportResponse:
    """
    Import a VSG JSON file to replace the current video's scene graph.

    This endpoint:
    1. Validates the uploaded JSON file structure
    2. Saves the file to {sample_dir}/outputs/imports/
    3. Updates the Video's vsg_path in the database
    4. Optionally clears all existing revisions (default: True)

    The imported VSG should have all revisions baked in, so clearing
    existing revisions prevents double-counting of changes.
    """
    # Verify video exists
    result = await db.execute(select(Video).where(Video.video_id == video_id))
    video = result.scalar_one_or_none()

    if video is None:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")

    # Validate file type
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(
            status_code=400, detail="File must be a .json file"
        )

    # Read and parse file content
    try:
        content = await file.read()
        vsg_data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON: {str(e)}"
        )
    except UnicodeDecodeError as e:
        raise HTTPException(
            status_code=400, detail=f"File encoding error: {str(e)}"
        )

    # Import the VSG
    service = ImportService(db)

    try:
        result = await service.import_vsg(
            video_id=video_id,
            vsg_data=vsg_data,
            user_id=user_id,
            clear_revisions=clear_revisions,
        )
        await db.commit()
    except VSGValidationError as e:
        raise HTTPException(status_code=400, detail=f"VSG validation failed: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ImportResponse(
        success=result["success"],
        video_id=result["video_id"],
        message=result["message"],
        revisions_cleared=result["revisions_cleared"],
        new_vsg_path=result["new_vsg_path"],
        imported_at=datetime.fromisoformat(result["imported_at"]),
    )
