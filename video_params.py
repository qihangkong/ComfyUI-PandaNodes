"""视频参数节点：宽、高、时长、fps → 总帧数计算"""
from .panda_utils import (
    PandaDefaults,
    PandaAlignment,
    PandaTypeUtils,
    PandaFormatUtils
)


class PandaVideoParams:
    """视频参数节点：宽、高、时长、fps → 总帧数计算"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": PandaDefaults.VIDEO_PARAMS["width"],
                    "min": 64, "max": 8192, "step": 1
                }),
                "height": ("INT", {
                    "default": PandaDefaults.VIDEO_PARAMS["height"],
                    "min": 64, "max": 8192, "step": 1
                }),
                "duration": ("FLOAT", {
                    "default": PandaDefaults.VIDEO_PARAMS["duration"],
                    "min": 0.1, "max": 300.0, "step": 0.1
                }),
                "fps": ("FLOAT", {
                    "default": PandaDefaults.VIDEO_PARAMS["fps"],
                    "min": 1.0, "max": 120.0, "step": 0.1
                }),
                "size_align": ([1, 4, 8, 16, 32], {
                    "default": PandaDefaults.VIDEO_PARAMS["size_align"]
                }),
                "frame_align": ([1, 4, 8, 16, 32], {
                    "default": PandaDefaults.VIDEO_PARAMS["frame_align"]
                }),
            }
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "FLOAT", "INT", "INT", "STRING", "PANDA_VIDEO_PARAMS")
    RETURN_NAMES = ("width", "height", "duration", "fps", "total_frames", "total_frames_inc", "info", "config")
    FUNCTION = "calculate_params"
    CATEGORY = "PandaNodes/Video"

    def calculate_params(self, width, height, duration, fps, size_align, frame_align):
        # 处理宽高对齐（向上取整）
        final_width = PandaAlignment.ceil_to_align(width, size_align)
        final_height = PandaAlignment.ceil_to_align(height, size_align)

        # 处理时长和帧率
        actual_duration = PandaTypeUtils.clamp(duration, 0.1, 300.0)
        actual_fps = PandaTypeUtils.clamp(fps, 1.0, 120.0)

        # 计算基础总帧数 (fps * duration)
        base_frames = round(actual_fps * actual_duration)
        total_frames = PandaAlignment.ceil_to_align(base_frames, frame_align)

        # 计算包含起始帧的总帧数（直接在对齐后的基础上 +1）
        total_frames_inc = total_frames + 1

        # 格式化信息字符串
        info = PandaFormatUtils.format_info_string(
            final_width, final_height, actual_duration,
            actual_fps, total_frames, total_frames_inc,
            size_align, frame_align
        )

        # 创建配置对象
        config = {
            "width": final_width,
            "height": final_height,
            "duration": actual_duration,
            "fps": actual_fps,
            "total_frames": total_frames,
            "total_frames_inc": total_frames_inc,
            "size_align": size_align,
            "frame_align": frame_align,
            "info": info,
        }

        return final_width, final_height, actual_duration, actual_fps, total_frames, total_frames_inc, info, config


class PandaGetVideoParams:
    """从 PandaVideoParams 的 config 对象中提取视频参数信息"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "config": ("PANDA_VIDEO_PARAMS", {}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "FLOAT", "INT", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "duration", "fps", "total_frames", "total_frames_inc", "size_align", "frame_align", "info")
    FUNCTION = "get_values"
    CATEGORY = "PandaNodes/Video"

    def get_values(self, config):
        defs = PandaDefaults.VIDEO_PARAMS
        return (
            config.get("width", defs["width"]),
            config.get("height", defs["height"]),
            config.get("duration", defs["duration"]),
            config.get("fps", defs["fps"]),
            config.get("total_frames", defs["total_frames"]),
            config.get("total_frames_inc", defs["total_frames_inc"]),
            config.get("size_align", defs["size_align"]),
            config.get("frame_align", defs["frame_align"]),
            config.get("info", "")
        )
