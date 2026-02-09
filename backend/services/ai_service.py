"""AI Service for attribute suggestions using Kimi 2.5 model."""

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

    if not any([color, texture, material, size, shape]):
        return None

    return {
        "visual": {
            "color": color or "unknown",
            "texture": texture or "unknown",
            "material": material or "unknown",
        },
        "physical": {
            "size": size or "medium",
            "shape": shape or "irregular",
        },
        "confidence": 0.2,
    }


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


def post_with_retries(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> requests.Response:
    """
    POST with basic retries and increasing timeouts.
    """
    last_error = None
    for attempt in range(3):
        try:
            timeout = 30 * (attempt + 1)  # 30s, 60s, 90s
            logger.info(f"API attempt {attempt + 1}/3 with timeout {timeout}s")
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
            return response
        except requests.exceptions.Timeout as e:
            last_error = e
            logger.warning(f"API timeout on attempt {attempt + 1}: {e}")
            if attempt < 2:
                import time
                time.sleep(2)
            continue
        except Exception as e:
            last_error = e
            logger.error(f"API error on attempt {attempt + 1}: {e}")
            raise
    raise ValueError(f"API request failed after 3 attempts. Last error: {last_error}")


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
    prompt = f"""You are analyzing an object in a video frame. Based on the cropped image provided, determine the visual and physical attributes of the object.

Object Category: {category}
Frame Number: {frame_idx}

Please analyze the object and provide attribute values using ONLY the following options:

VISUAL ATTRIBUTES:
- color: Choose ONE from: {', '.join(COLOR_VALUES)}
- texture: Choose ONE from: {', '.join(TEXTURE_VALUES)}
- material: Choose ONE from: {', '.join(MATERIAL_VALUES)}

PHYSICAL ATTRIBUTES:
- size: Choose ONE from: {', '.join(SIZE_VALUES)}
- shape: Choose ONE from: {', '.join(SHAPE_VALUES)}

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
  "physical": {{
    "size": "selected_size",
    "shape": "selected_shape"
  }},
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

        response = post_with_retries(api_url, headers, payload)

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

        # Validate and correct values if needed
        if visual.get('color') not in COLOR_VALUES:
            visual['color'] = 'unknown'
        if visual.get('texture') not in TEXTURE_VALUES:
            visual['texture'] = 'unknown'
        if visual.get('material') not in MATERIAL_VALUES:
            visual['material'] = 'unknown'
        if physical.get('size') not in SIZE_VALUES:
            physical['size'] = 'medium'
        if physical.get('shape') not in SHAPE_VALUES:
            physical['shape'] = 'irregular'

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

    except Exception as e:
        logger.error(f"Error getting AI suggestions: {str(e)}")
        # Return default/fallback suggestions
        error_result = {
            "visual": {
                "color": "unknown",
                "texture": "unknown",
                "material": "unknown"
            },
            "physical": {
                "size": "medium",
                "shape": "irregular"
            },
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
