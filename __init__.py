# __init__.py for ComfyUI-PandaNodes

from .image_size import PandaImageSize

# Register all nodes
NODE_CLASS_MAPPINGS = {
    "PandaImageSize": PandaImageSize,
}

# Display names for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "PandaImageSize": "Panda Image Size",
}
