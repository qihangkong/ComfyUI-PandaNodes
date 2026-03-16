import math

class PandaVideoParams:
    """视频参数节点：宽、高、时长、fps → 总帧数计算"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 1
                }),
                "height": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 1
                }),
                "duration": ("FLOAT", {
                    "default": 10.0, "min": 0.1, "max": 300.0, "step": 0.1
                }),
                "fps": ("FLOAT", {
                    "default": 24.0, "min": 1.0, "max": 120.0, "step": 0.1
                }),
                "size_align": ([1, 4, 8, 16, 32], {"default": 8}),
                "frame_align": ([1, 4, 8, 16, 32], {"default": 1}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "FLOAT", "INT", "INT", "STRING", "PANDA_VIDEO_PARAMS")
    RETURN_NAMES = ("width", "height", "duration", "fps", "total_frames", "total_frames_inc", "info", "config")
    FUNCTION = "calculate_params"
    CATEGORY = "PandaNodes/Video"

    def calculate_params(self, width, height, duration, fps, size_align, frame_align):
        # 处理宽高对齐（向上取整）
        def ceil_to_align(value, align):
            if align <= 1:
                return int(value)
            return int(math.ceil(value / align) * align)

        final_width = ceil_to_align(width, size_align)
        final_height = ceil_to_align(height, size_align)

        # 处理时长和帧率
        actual_duration = max(0.1, min(300.0, duration))
        actual_fps = max(1.0, min(120.0, fps))

        # 计算基础总帧数 (fps * duration)
        base_frames = round(actual_fps * actual_duration)
        total_frames = ceil_to_align(base_frames, frame_align)

        # 计算包含起始帧的总帧数（直接在对齐后的基础上 +1）
        total_frames_inc = total_frames + 1

        # 格式化信息字符串
        info = f"{final_width}x{final_height} | {actual_fps:.1f} FPS | {actual_duration:.1f}s | {total_frames} frames ({total_frames_inc} inc) (size_align:{size_align}, frame_align:{frame_align})"

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
        return (
            config.get("width", 1024),
            config.get("height", 1024),
            config.get("duration", 10.0),
            config.get("fps", 24),
            config.get("total_frames", 240),
            config.get("total_frames_inc", 241),
            config.get("size_align", 8),
            config.get("frame_align", 1),
            config.get("info", "")
        )
