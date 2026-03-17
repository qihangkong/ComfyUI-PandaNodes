"""Panda LLaMA VLM 节点：多模态模型加载和交互（集成版）"""
import os
import gc
import json
import base64
import io
import numpy as np
from PIL import Image

import folder_paths
import comfy.model_management as mm

try:
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import (
        Llava15ChatHandler, Llava16ChatHandler, MoondreamChatHandler,
        NanoLlavaChatHandler, Llama3VisionAlphaChatHandler, MiniCPMv26ChatHandler
    )
    _LLAMA_CPP_AVAILABLE = True
except ImportError:
    _LLAMA_CPP_AVAILABLE = False

from .panda_utils import PandaDefaults, PandaTypeUtils

# 尝试导入额外的聊天处理器
chat_handlers = ["None", "LLaVA-1.5", "LLaVA-1.6", "Moondream2", "nanoLLaVA", "llama3-Vision-Alpha", "MiniCPM-v2.6"]

if _LLAMA_CPP_AVAILABLE:
    try:
        from llama_cpp.llama_chat_format import MTMDChatHandler
        _MTMD = True
    except ImportError:
        _MTMD = False

    try:
        from llama_cpp.llama_chat_format import Gemma3ChatHandler
        chat_handlers += ["Gemma3"]
    except ImportError:
        Gemma3ChatHandler = None

    try:
        from llama_cpp.llama_chat_format import Qwen25VLChatHandler
        chat_handlers += ["Qwen2.5-VL"]
    except ImportError:
        Qwen25VLChatHandler = None

    try:
        from llama_cpp.llama_chat_format import Qwen3VLChatHandler
        chat_handlers += ["Qwen3-VL", "Qwen3-VL-Thinking"]
    except ImportError:
        Qwen3VLChatHandler = None

    try:
        from llama_cpp.llama_chat_format import Qwen35ChatHandler
        chat_handlers += ["Qwen3.5", "Qwen3.5-Thinking"]
    except ImportError:
        Qwen35ChatHandler = None

    try:
        from llama_cpp.llama_chat_format import (GLM46VChatHandler, LFM2VLChatHandler, GLM41VChatHandler)
        chat_handlers += ["GLM-4.6V", "GLM-4.6V-Thinking", "GLM-4.1V-Thinking", "LFM2-VL"]
    except ImportError:
        GLM46VChatHandler = None
        LFM2VLChatHandler = None
        GLM41VChatHandler = None

# 预设提示模板
PRESET_PROMPTS = {
    "Empty - Nothing": "",
    "Normal - Describe": "Describe this @.",
    "Prompt Style - Tags": "Your task is to generate a clean list of comma-separated tags for a text-to-@ AI, based *only* on the visual information in the @. Limit the output to a maximum of 50 unique tags.",
    "Prompt Style - Simple": "Analyze the @ and generate a simple, single-sentence text-to-@ prompt.",
    "Prompt Style - Detailed": "Generate a detailed, artistic text-to-@ prompt based on the @. Combine the subject, their actions, the environment, lighting, and overall mood into a single, cohesive paragraph of about 2-3 sentences.",
    "Question - What is this?": "What is in this @?",
    "Question - Detailed Analysis": "Describe this @ in detail, breaking down the subject, attire, accessories, background, and composition into separate sections.",
}

preset_tags = list(PRESET_PROMPTS.keys())


class AnyType(str):
    """自定义类型，用于表示任意类型"""
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


# 全局存储类，用于在节点间共享模型
class PandaLLamaStorage:
    """Panda LLaMA 模型存储类"""
    llm = None
    chat_handler = None
    current_config = None
    messages = {}
    sys_prompts = {}

    @classmethod
    def clean_state(cls, id=-1):
        """清理指定ID的状态或所有状态"""
        if id == -1:
            cls.messages.clear()
            cls.sys_prompts.clear()
        else:
            cls.messages.pop(f"{id}", None)
            cls.sys_prompts.pop(f"{id}", None)

    @classmethod
    def clean(cls, all=False):
        """清理所有加载的模型和状态"""
        try:
            if cls.llm:
                cls.llm.close()
        except Exception:
            pass

        try:
            if cls.chat_handler and hasattr(cls.chat_handler, "_exit_stack"):
                cls.chat_handler._exit_stack.close()
        except Exception:
            pass

        cls.llm = None
        cls.chat_handler = None
        cls.current_config = None
        if all:
            cls.clean_state()

        gc.collect()
        mm.soft_empty_cache()

    @classmethod
    def _get_chat_handler_class(cls, chat_handler_name):
        """根据名称获取聊天处理器类"""
        if not _LLAMA_CPP_AVAILABLE:
            return None

        handler_map = {
            "Qwen3.5": Qwen35ChatHandler,
            "Qwen3.5-Thinking": Qwen35ChatHandler,
            "Qwen3-VL": Qwen3VLChatHandler,
            "Qwen3-VL-Thinking": Qwen3VLChatHandler,
            "Qwen2.5-VL": Qwen25VLChatHandler,
            "LLaVA-1.5": Llava15ChatHandler,
            "LLaVA-1.6": Llava16ChatHandler,
            "Moondream2": MoondreamChatHandler,
            "nanoLLaVA": NanoLlavaChatHandler,
            "llama3-Vision-Alpha": Llama3VisionAlphaChatHandler,
            "MiniCPM-v2.6": MiniCPMv26ChatHandler,
            "MiniCPM-v4.5": MiniCPMv26ChatHandler,
            "MiniCPM-v4.5-Thinking": MiniCPMv26ChatHandler,
            "Gemma3": Gemma3ChatHandler,
            "GLM-4.6V": GLM46VChatHandler,
            "GLM-4.6V-Thinking": GLM46VChatHandler,
            "GLM-4.1V-Thinking": GLM41VChatHandler,
            "LFM2-VL": LFM2VLChatHandler,
            "None": None,
        }
        return handler_map.get(chat_handler_name, None)

    @classmethod
    def load_model(cls, config):
        """加载模型"""
        if not _LLAMA_CPP_AVAILABLE:
            raise ImportError("llama-cpp-python is not installed! Please install it first.")

        cls.clean(all=True)
        cls.current_config = config.copy()

        model = config["model"]
        mmproj = config["mmproj"]
        chat_handler_name = config["chat_handler"]
        n_ctx = config["n_ctx"]
        vram_limit = config["vram_limit"]
        image_max_tokens = config["image_max_tokens"]
        image_min_tokens = config["image_min_tokens"]
        n_gpu_layers = -1

        model_path = os.path.join(folder_paths.models_dir, 'LLM', model)
        handler_class = cls._get_chat_handler_class(chat_handler_name)

        # 计算 GPU 层数（如果设置了 VRAM 限制）
        if vram_limit != -1:
            try:
                gguf_size = os.path.getsize(model_path) * 1.55 / (1024 ** 3)
                gguf_layers = 32  # 默认层数
                gguf_layer_size = gguf_size / gguf_layers
            except (OSError, FileNotFoundError):
                gguf_layer_size = 0

        # 加载 mmproj（如果有）
        if mmproj and mmproj != "None":
            mmproj_path = os.path.join(folder_paths.models_dir, 'LLM', mmproj)
            if chat_handler_name == "None":
                raise ValueError('"chat_handler" cannot be None when using mmproj!')

            if vram_limit != -1 and os.path.exists(mmproj_path):
                try:
                    mmproj_size = os.path.getsize(mmproj_path) * 1.55 / (1024 ** 3)
                    if gguf_layer_size > 0:
                        n_gpu_layers = max(1, int((vram_limit - mmproj_size) / gguf_layer_size))
                except (OSError, FileNotFoundError):
                    pass

            print(f"[PandaVLM] Loading mmproj: {mmproj}")

            think_mode = "Thinking" in chat_handler_name
            kwargs = {"clip_model_path": mmproj_path, "verbose": False}

            if chat_handler_name in ["Qwen3-VL", "Qwen3-VL-Thinking"]:
                kwargs["force_reasoning"] = think_mode
                kwargs["image_max_tokens"] = image_max_tokens
                kwargs["image_min_tokens"] = image_min_tokens
            elif chat_handler_name in ["MiniCPM-v4.5", "GLM-4.6V", "Qwen3.5"]:
                kwargs["enable_thinking"] = think_mode

            if _MTMD:
                kwargs["image_max_tokens"] = image_max_tokens
                kwargs["image_min_tokens"] = image_min_tokens

            try:
                cls.chat_handler = handler_class(**kwargs)
            except Exception as e:
                raise RuntimeError(f"{e}\nFailed to load mmproj!")
        else:
            if vram_limit != -1 and 'gguf_layer_size' in locals() and gguf_layer_size > 0:
                n_gpu_layers = max(1, int(vram_limit / gguf_layer_size))
            if handler_class is not None:
                cls.chat_handler = handler_class(verbose=False)
            else:
                cls.chat_handler = None

        print(f"[PandaVLM] Loading model: {model}")
        print(f"[PandaVLM] n_gpu_layers = {n_gpu_layers}")
        cls.llm = Llama(
            model_path,
            chat_handler=cls.chat_handler,
            n_gpu_layers=n_gpu_layers,
            n_ctx=n_ctx,
            verbose=False
        )


def image2base64(image_array):
    """将 numpy 数组转换为 base64 编码的 JPEG"""
    if image_array.ndim == 2:
        image_array = np.stack([image_array] * 3, axis=-1)
    elif image_array.ndim == 3 and image_array.shape[2] == 4:
        image_array = image_array[:, :, :3]

    image = Image.fromarray(image_array)
    buffered = io.BytesIO()
    image.save(buffered, format="JPEG", quality=95)
    return base64.b64encode(buffered.getvalue()).decode('utf-8')


def scale_image(image_array, max_size):
    """缩放图像到指定的最大尺寸"""
    height, width = image_array.shape[:2]
    scale = max_size / max(height, width)
    if scale < 1.0:
        new_height = int(height * scale)
        new_width = int(width * scale)
        img = Image.fromarray(image_array)
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        return np.array(img)
    return image_array


class PandaVLM:
    """Panda VLM 节点：集成模型加载和交互的全能节点"""

    @classmethod
    def INPUT_TYPES(cls):
        all_llms = folder_paths.get_filename_list("LLM")
        model_list = [f for f in all_llms if "mmproj" not in f.lower()]
        mmproj_list = ["None"] + [f for f in all_llms if "mmproj" in f.lower()]

        return {
            "required": {
                # 模型配置
                "model": (model_list, {"tooltip": "主模型文件"}),
                "mmproj": (mmproj_list, {"default": "None", "tooltip": "视觉投影文件（用于图像理解）"}),
                "chat_handler": (chat_handlers, {"default": "None", "tooltip": "聊天处理器类型"}),
                "n_ctx": ("INT", {
                    "default": 8192,
                    "min": 1024, "max": 327680, "step": 128,
                    "tooltip": "上下文长度限制"
                }),
                "vram_limit": ("INT", {
                    "default": -1,
                    "min": -1, "max": 1024, "step": 1,
                    "tooltip": "VRAM 限制（-1 表示无限制）"
                }),
                "image_min_tokens": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 32, "tooltip": "图像最小标记数"}),
                "image_max_tokens": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 32, "tooltip": "图像最大标记数"}),

                # 提示配置
                "preset_prompt": (preset_tags, {"default": preset_tags[1], "tooltip": "预设提示模板"}),
                "custom_prompt": ("STRING", {"default": "", "multiline": True, "placeholder": "自定义提示文本"}),
                "system_prompt": ("STRING", {"multiline": True, "default": "", "tooltip": "系统提示"}),

                # 推理配置
                "inference_mode": (["one by one", "images", "video"], {
                    "default": "one by one",
                    "tooltip": "one by one: 逐个处理图像\nimages: 一次性处理所有图像\nvideo: 作为视频处理"
                }),
                "max_frames": ("INT", {
                    "default": 24,
                    "min": 2,
                    "max": 1024,
                    "step": 1,
                    "tooltip": "视频模式下采样的帧数"
                }),
                "max_size": ("INT", {
                    "default": 256,
                    "min": 128,
                    "max": 16384,
                    "step": 64,
                    "tooltip": "图像的最大尺寸"
                }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "step": 1}),

                # 生成参数
                "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 32768, "step": 1}),
                "temperature": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 2.0, "step": 0.01}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 30, "min": 1, "max": 100, "step": 1}),
                "repeat_penalty": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01}),

                # 状态配置
                "force_offload": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "推理后卸载模型"
                }),
                "save_states": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "保存对话上下文"
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
            "optional": {
                "images": ("IMAGE",),
                "queue_handler": (any_type, {"tooltip": "控制节点执行顺序"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT")
    RETURN_NAMES = ("output", "output_list", "state_uid")
    OUTPUT_IS_LIST = (False, True, False)
    FUNCTION = "process"
    CATEGORY = "PandaNodes/VLM"

    def sanitize_messages(self, messages):
        """清理消息中的图像数据（用于存储）"""
        clean_messages = messages.copy()
        for msg in clean_messages:
            content = msg.get("content")
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "image_url":
                        # 替换为占位图像
                        item["image_url"]["url"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC"
        return clean_messages

    def process(self, model, mmproj, chat_handler, n_ctx, vram_limit, image_min_tokens, image_max_tokens,
                preset_prompt, custom_prompt, system_prompt, inference_mode, max_frames, max_size, seed,
                max_tokens, temperature, top_p, top_k, repeat_penalty,
                force_offload, save_states, unique_id, images=None, queue_handler=None):
        """处理输入并生成输出"""
        if not _LLAMA_CPP_AVAILABLE:
            raise ImportError("llama-cpp-python is not installed! Please install it first.")

        # 构建模型配置
        model_config = {
            "model": model,
            "mmproj": mmproj,
            "chat_handler": chat_handler,
            "n_ctx": n_ctx,
            "vram_limit": vram_limit,
            "image_min_tokens": image_min_tokens,
            "image_max_tokens": image_max_tokens
        }

        # 检查是否需要重新加载模型
        if not PandaLLamaStorage.llm or PandaLLamaStorage.current_config != model_config:
            print("[PandaVLM] Loading model...")
            PandaLLamaStorage.load_model(model_config)

        # 准备推理参数
        parameters = {
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repeat_penalty": repeat_penalty,
            "min_p": 0.05,
            "typical_p": 1.0,
            "frequency_penalty": 0.0,
            "presence_penalty": 1.0,
            "mirostat_mode": 0,
            "mirostat_eta": 0.1,
            "mirostat_tau": 5.0,
        }

        _uid = parameters.get("state_uid", None)
        _parameters = parameters.copy()
        _parameters.pop("state_uid", None)
        uid = unique_id.rpartition('.')[-1] if _uid in (None, -1) else _uid

        last_sys_prompt = PandaLLamaStorage.sys_prompts.get(f"{uid}", None)
        video_input = inference_mode == "video"
        system_prompts = "请将输入的图片序列当做视频而不是静态帧序列, " + system_prompt if video_input else system_prompt

        # 处理系统提示
        if last_sys_prompt != system_prompts:
            messages = []
            PandaLLamaStorage.clean_state()
            PandaLLamaStorage.sys_prompts[f"{uid}"] = system_prompts
            if system_prompts.strip():
                messages.append({"role": "system", "content": system_prompts})
        else:
            if save_states:
                try:
                    print(f"[PandaVLM] Loading state id={uid}...")
                    messages = PandaLLamaStorage.messages.get(f"{uid}", [])
                except Exception:
                    messages = []
            else:
                messages = []

        out1 = ""
        out2 = []
        user_content = []

        # 准备用户提示
        if custom_prompt.strip() and "*" not in preset_prompt:
            user_content.append({"type": "text", "text": custom_prompt})
        else:
            p = PRESET_PROMPTS[preset_prompt].replace("#", custom_prompt.strip()).replace("@", "video" if video_input else "image")
            user_content.append({"type": "text", "text": p})

        # 处理图像
        if images is not None:
            if not hasattr(PandaLLamaStorage.chat_handler, "clip_model_path") or PandaLLamaStorage.chat_handler.clip_model_path is None:
                raise ValueError("检测到图像输入，但加载的模型未配置 mmproj 模块！")

            frames = images
            if video_input:
                indices = np.linspace(0, len(images) - 1, max_frames, dtype=int)
                frames = [images[i] for i in indices]

            if inference_mode == "one by one":
                # 逐个处理图像
                tmp_list = []
                image_content = {
                    "type": "image_url",
                    "image_url": {"url": ""}
                }
                user_content.append(image_content)
                messages.append({"role": "user", "content": user_content})
                print(f"[PandaVLM] Processing {len(frames)} images")

                for i, image in enumerate(frames):
                    if mm.processing_interrupted():
                        raise mm.InterruptProcessingException()
                    data = image2base64(np.clip(255.0 * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))
                    for item in user_content:
                        if item.get("type") == "image_url":
                            item["image_url"]["url"] = f"data:image/jpeg;base64,{data}"
                            break
                    output = PandaLLamaStorage.llm.create_chat_completion(messages=messages, seed=seed, **_parameters)
                    text = output['choices'][0]['message']['content'].removeprefix(": ").lstrip()
                    out2.append(text)
                    if len(frames) > 1:
                        tmp_list.append(f"====== Image {i+1} ======")
                    tmp_list.append(text)

                out1 = "\n\n".join(tmp_list)
            else:
                # 一次性处理所有图像
                for image in frames:
                    if len(frames) > 1:
                        data = image2base64(scale_image(np.clip(255.0 * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8), max_size))
                    else:
                        data = image2base64(np.clip(255.0 * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))
                    image_content = {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{data}"}
                    }
                    user_content.append(image_content)

                messages.append({"role": "user", "content": user_content})
                output = PandaLLamaStorage.llm.create_chat_completion(messages=messages, seed=seed, **_parameters)
                out1 = output['choices'][0]['message']['content'].removeprefix(": ").lstrip()
                out2 = [out1]
        else:
            # 纯文本输入
            messages.append({"role": "user", "content": user_content})
            output = PandaLLamaStorage.llm.create_chat_completion(messages=messages, seed=seed, **_parameters)
            out1 = output['choices'][0]['message']['content'].removeprefix(": ").lstrip()
            out2 = [out1]

        # 保存状态
        if save_states:
            print(f"[PandaVLM] Saving state id={uid}...")
            messages.append({"role": "assistant", "content": out1})
            clear_message = self.sanitize_messages(messages)
            PandaLLamaStorage.messages[f"{uid}"] = clear_message
        else:
            if not PandaLLamaStorage.messages.get(f"{uid}"):
                PandaLLamaStorage.sys_prompts.pop(f"{uid}", None)

        # 强制卸载模型
        if force_offload:
            PandaLLamaStorage.clean()
        else:
            if PandaLLamaStorage.current_config and "chat_handler" in PandaLLamaStorage.current_config:
                if PandaLLamaStorage.current_config["chat_handler"] in ["Qwen3.5", "Qwen3.5-Thinking"]:
                    if PandaLLamaStorage.llm:
                        PandaLLamaStorage.llm.n_tokens = 0
                        if hasattr(PandaLLamaStorage.llm, "_ctx"):
                            PandaLLamaStorage.llm._ctx.memory_clear(True)
                        if hasattr(PandaLLamaStorage.llm, "is_hybrid") and PandaLLamaStorage.llm.is_hybrid:
                            if hasattr(PandaLLamaStorage.llm, "_hybrid_cache_mgr") and PandaLLamaStorage.llm._hybrid_cache_mgr:
                                PandaLLamaStorage.llm._hybrid_cache_mgr.clear()

        del messages
        gc.collect()
        return (out1, out2, uid)


# 注册 LLM 文件夹
llm_extensions = ['.ckpt', '.pt', '.bin', '.pth', '.safetensors', '.gguf']
if "LLM" not in folder_paths.folder_names_and_paths:
    folder_paths.folder_names_and_paths["LLM"] = (
        [os.path.join(folder_paths.models_dir, "LLM")],
        llm_extensions
    )

# 清理钩子（可选）
if hasattr(mm, "unload_all_models_backup"):
    pass
else:
    mm.unload_all_models_backup = mm.unload_all_models
    def patched_unload_all_models(*args, **kwargs):
        PandaLLamaStorage.clean(all=True)
        return mm.unload_all_models_backup(*args, **kwargs)
    mm.unload_all_models = patched_unload_all_models
    print("[PandaVLM] Model cleanup hook applied!")
