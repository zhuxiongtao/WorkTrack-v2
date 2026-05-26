"""WorkTrack 自定义异常体系"""


class WorkTrackError(Exception):
    """基础异常"""
    def __init__(self, message: str = "", *args):
        self.message = message
        super().__init__(message, *args)


class AIServiceError(WorkTrackError):
    """AI 服务调用异常"""
    pass


class AIRateLimitError(AIServiceError):
    """AI 服务限流异常"""
    pass


class AITimeoutError(AIServiceError):
    """AI 服务超时异常"""
    pass


class VectorStoreError(WorkTrackError):
    """向量存储异常"""
    pass


class DocumentParseError(WorkTrackError):
    """文档解析异常"""
    pass


class WebSearchError(WorkTrackError):
    """网络搜索异常"""
    pass


class AuthenticationError(WorkTrackError):
    """认证异常"""
    pass


class PermissionDeniedError(WorkTrackError):
    """权限不足异常"""
    pass


class ResourceNotFoundError(WorkTrackError):
    """资源不存在异常"""
    pass


class ValidationError(WorkTrackError):
    """数据校验异常"""
    pass
