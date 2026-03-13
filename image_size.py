import math


class PandaImageSize:
    """图片尺寸节点：宽高比 + 宽高 + 对齐"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": ([
                    "1:1", "16:9", "5:4", "4:3", "3:2", "2:3",
                    "2.39:1", "21:9", "18:9", "17:9", "1.85:1",
                    "9:16", "4:5", "3:4", "Custom"
                ], {"default": "1:1"}),
                "width": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 1
                }),
                "height": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 1
                }),
                "align": ([1, 8, 16, 32], {"default": 8}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "PANDA_IMAGE_SIZE")
    RETURN_NAMES = ("width", "height", "info", "config")
    FUNCTION = "calculate_size"
    CATEGORY = "PandaNodes/Image"

    def calculate_size(self, aspect_ratio, width, height, align):
        # 定义宽高比
        ratios = {
            "1:1": (1, 1), "16:9": (16, 9), "5:4": (5, 4), "4:3": (4, 3),
            "3:2": (3, 2), "2:3": (2, 3), "2.39:1": (2.39, 1), "21:9": (21, 9),
            "18:9": (18, 9), "17:9": (17, 9), "1.85:1": (1.85, 1),
            "9:16": (9, 16), "4:5": (4, 5), "3:4": (3, 4),
        }

        # 四舍五入到对齐倍数
        def round_to_align(value, align):
            return int(round(value / align) * align)

        if aspect_ratio == "Custom":
            # 自定义模式：直接使用用户设置的宽高
            final_width = round_to_align(width, align)
            final_height = round_to_align(height, align)
        else:
            # 固定宽高比模式：业界做法 - 以 width 为基准计算 height
            w_ratio, h_ratio = ratios.get(aspect_ratio, (1, 1))
            final_width = round_to_align(width, align)
            final_height = round_to_align(final_width * h_ratio / w_ratio, align)

        info = f"{final_width}x{final_height} | {aspect_ratio} | align:{align}"

        # 创建配置对象
        config = {
            "width": final_width,
            "height": final_height,
            "aspect_ratio": aspect_ratio,
            "align": align,
            "info": info,
        }

        return final_width, final_height, info, config


class PandaGetImageSize:
    """从 PandaImageSize 的 config 对象中提取尺寸信息"""
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
