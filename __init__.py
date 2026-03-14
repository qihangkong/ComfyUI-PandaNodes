# __init__.py for ComfyUI-PandaNodes

from .image_size import PandaImageSize, PandaGetImageSize
from .video_params import PandaVideoParams, PandaGetVideoParams

# Register all nodes
NODE_CLASS_MAPPINGS = {
    "PandaImageSize": PandaImageSize,
    "PandaGetImageSize": PandaGetImageSize,
    "PandaVideoParams": PandaVideoParams,
    "PandaGetVideoParams": PandaGetVideoParams,
}

# Display names for nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "PandaImageSize": "Panda Image Size",
    "PandaGetImageSize": "Panda Get Image Size",
    "PandaVideoParams": "Panda Video Params",
    "PandaGetVideoParams": "Panda Get Video Params",
}

# Web directory for frontend extensions
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
