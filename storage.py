"""PandaGetImageSize - 从 PandaImageSize 的 config 对象中提取尺寸信息"""


class PandaGetImageSize:
    """
    从 PandaImageSize 的 config 对象中提取尺寸信息

    使用方式：
    [PandaImageSize] ──→ config ──→ [KJNodes SetNode] 保存
                                          storage_id="my_config"

    [KJNodes GetNode]               ──→ config ──→ [PandaGetImageSize]
    storage_id="my_config"                              ↓
                                                width, height, info, ...
                                                    ↓
                                                [你的节点]
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "config": ("PANDA_IMAGE_SIZE", {}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "STRING", "INT")
    RETURN_NAMES = ("width", "height", "info", "aspect_ratio", "align")
    FUNCTION = "get_values"
    CATEGORY = "PandaNodes/Image"

    def get_values(self, config):
        return (
            config.get("width", 1024),
            config.get("height", 1024),
            config.get("info", ""),
            config.get("aspect_ratio", "1:1"),
            config.get("align", 8)
        )
