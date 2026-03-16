"""PandaNodes 共享工具函数"""
import math


class PandaDefaults:
    """集中管理所有节点的默认值"""
    VIDEO_PARAMS = {
        "width": 1024,
        "height": 1024,
        "duration": 10.0,
        "fps": 24.0,
        "total_frames": 240,
        "total_frames_inc": 241,
        "size_align": 8,
        "frame_align": 1
    }

    IMAGE_SIZE = {
        "width": 1024,
        "height": 1024,
        "aspect_ratio": "1:1",
        "align": 8
    }


class PandaAlignment:
    """对齐相关的工具函数"""
    @staticmethod
    def ceil_to_align(value, align):
        """向上取整到对齐值的倍数"""
        if align <= 1:
            return int(value)
        return int(math.ceil(value / align) * align)

    @staticmethod
    def round_to_align(value, align):
        """四舍五入到对齐值的倍数"""
        return int(round(value / align) * align)

    @staticmethod
    def floor_to_align(value, align):
        """向下取整到对齐值的倍数"""
        if align <= 1:
            return int(value)
        return int(math.floor(value / align) * align)


class PandaTypeUtils:
    """类型和验证工具"""
    @staticmethod
    def are_types_compatible(output_type, input_type):
        """检查类型是否兼容"""
        if output_type == '*' or input_type == '*':
            return True
        output_types = output_type.split(",")
        input_types = input_type.split(",")
        return any(t1 == t2 for t1 in output_types for t2 in input_types)

    @staticmethod
    def clamp(value, min_val, max_val):
        """将值限制在指定范围内"""
        return max(min_val, min(max_val, value))


class PandaFormatUtils:
    """格式化工具"""
    @staticmethod
    def format_info_string(width, height, duration, fps, frames, inc_frames, size_align, frame_align):
        """格式化视频参数信息字符串"""
        return (f"{width}x{height} | {fps:.1f} FPS | {duration:.1f}s | "
                f"{frames} frames ({inc_frames} inc) (size_align:{size_align}, frame_align:{frame_align})")

    @staticmethod
    def format_image_info(width, height, aspect_ratio, align):
        """格式化图片尺寸信息字符串"""
        return f"{width}x{height} | {aspect_ratio} | align:{align}"
