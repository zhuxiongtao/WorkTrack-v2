import chromadb
from chromadb.config import Settings
from openai import OpenAI
from sqlmodel import Session, select
from app.config import settings
from app.models.model_provider import ModelProvider, TaskModelConfig

# 初始化 ChromaDB 持久化客户端
import os
os.makedirs(settings.chroma_persist_dir, exist_ok=True)

chroma_client = chromadb.PersistentClient(
    path=settings.chroma_persist_dir,
    settings=Settings(anonymized_telemetry=False),
)


def _get_embedding_config(db: Session = None) -> tuple:
    """获取嵌入模型配置"""
    if db:
        task_cfg = db.exec(
            select(TaskModelConfig).where(TaskModelConfig.task_type == "embedding")
        ).first()
        if task_cfg and task_cfg.provider_id and task_cfg.model_name:
            provider = db.get(ModelProvider, task_cfg.provider_id)
            if provider and provider.is_active and provider.api_key:
                return provider.base_url, provider.api_key, task_cfg.model_name
        provider = db.exec(
            select(ModelProvider).where(
                ModelProvider.is_active == True, ModelProvider.api_key != ""
            )
        ).first()
        if provider:
            model = settings.embedding_model_name
            return provider.base_url, provider.api_key, model
    return (
        settings.effective_embedding_base_url,
        settings.effective_embedding_api_key,
        settings.embedding_model_name,
    )


def get_collection(name: str):
    """获取或创建向量集合"""
    return chroma_client.get_or_create_collection(name=name)


def _get_embedding_client(base_url: str, api_key: str) -> OpenAI:
    return OpenAI(base_url=base_url, api_key=api_key, timeout=30)


def embed_text(text: str, db: Session = None) -> list[float]:
    """将文本转换为向量嵌入"""
    base_url, api_key, model = _get_embedding_config(db)
    client = _get_embedding_client(base_url, api_key)
    resp = client.embeddings.create(model=model, input=text)
    return resp.data[0].embedding


def index_document(
    collection_name: str, doc_id: str, text: str, metadata: dict, db: Session = None
):
    """索引文档到向量数据库"""
    try:
        collection = get_collection(collection_name)
        embedding = embed_text(text, db)
        collection.upsert(
            ids=[doc_id],
            embeddings=[embedding],
            metadatas=[metadata],
            documents=[text],
        )
    except Exception as e:
        print(f"向量索引失败 [{collection_name}]: {e}")


def search_similar(
    collection_name: str,
    query: str,
    top_k: int = 5,
    filter_meta: dict = None,
    db: Session = None,
) -> dict:
    """语义搜索相似文档"""
    collection = get_collection(collection_name)
    query_emb = embed_text(query, db)
    results = collection.query(
        query_embeddings=[query_emb],
        n_results=top_k,
        where=filter_meta,
    )
    return results


def delete_document(collection_name: str, doc_id: str):
    """从向量数据库删除文档"""
    try:
        collection = get_collection(collection_name)
        collection.delete(ids=[doc_id])
    except Exception as e:
        print(f"向量删除失败 [{collection_name}]: {e}")
