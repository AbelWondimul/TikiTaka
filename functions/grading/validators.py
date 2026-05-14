"""Pydantic models for validating incoming Firestore trigger data and callable inputs."""
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator


class GradingJobData(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    studentId: str = Field(min_length=1, max_length=128)
    teacherId: str = Field(min_length=1, max_length=128)
    submissionType: Literal['pdf', 'text'] = 'pdf'
    rawPdfUrl: Optional[str] = None
    submissionText: Optional[str] = Field(default=None, max_length=50000)
    rubric: object = None

    @field_validator('rawPdfUrl')
    @classmethod
    def pdf_url_required_for_pdf(cls, v, info):
        if info.data.get('submissionType') == 'pdf' and not v:
            raise ValueError('rawPdfUrl is required when submissionType is pdf')
        return v


class GenerateQuizInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    prompt: Optional[str] = Field(default=None, max_length=500)
    excludedDocIds: list[str] = Field(default_factory=list)
    useKnowledgeBase: bool = True
    questionCount: int = Field(default=10, ge=1, le=30)
    difficulty: Literal['easy', 'medium', 'hard', 'mixed'] = 'mixed'
    questionTypes: list[Literal['mcq', 'short', 'long']] = Field(default_factory=lambda: ['mcq'])


class GenerateRubricInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    rawPdfPath: str = Field(min_length=1, max_length=512)


class ExtractPdfPagesInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    assignmentId: str = Field(min_length=1, max_length=128)
    storagePath: str = Field(min_length=1, max_length=512)


class QuickGenerateInput(BaseModel):
    classId: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=3, max_length=500)
    useKnowledgeBase: bool = True
    questionCount: int = Field(default=10, ge=1, le=30)
    difficulty: Literal['easy', 'medium', 'hard', 'mixed'] = 'mixed'
    questionTypes: list[Literal['mcq', 'short', 'long']] = Field(default_factory=lambda: ['mcq'])
