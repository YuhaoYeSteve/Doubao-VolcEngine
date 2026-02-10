import os
import configparser
from volcenginesdkarkruntime import Ark

# 从配置文件中读取API KEY
config = configparser.ConfigParser()
config.read('config.ini')
api_key = config.get('ARK', 'api_key')

client = Ark(
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    api_key=api_key,
)

# 使用正确的 API 调用方式
response = client.chat.completions.create(
    model="doubao-seed-1-8-251228",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "你看见了什么？"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/ark_demo_img_1.png"
                    }
                }
            ]
        }
    ]
)

# 格式化输出结果
print("\n=== Ark Demo 结果 ===")
print(f"模型: {response.model}")
print(f"响应ID: {response.id}")
print(f"生成时间: {response.created}")
print(f"\nAI 回答:")
print(response.choices[0].message.content)
print(f"\n=== 调用统计 ===")
print(f"提示词令牌数: {response.usage.prompt_tokens}")
print(f"回答令牌数: {response.usage.completion_tokens}")
print(f"总令牌数: {response.usage.total_tokens}")