from enum import Enum


class ImageType(str, Enum):
    COVER = "cover"
    SCENE = "scene"
    DETAIL = "detail"
    DIMENSION = "dimension"
    LIFESTYLE = "lifestyle"
    OTHER = "other"

