# __init__.py for ComfyUI-PandaNodes

from .image_size import PandaImageSize
from .storage import PandaGetImageSize

# Register all nodes
NODE_CLASS_MAPPINGS = {
    "PandaImageSize": PandaImageSize,
    "PandaGetImageSize": PandaGetImageSize,
}

# Display names for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "PandaImageSize": "Panda Image Size",
    "PandaGetImageSize": "Panda Get Image Size",
}
