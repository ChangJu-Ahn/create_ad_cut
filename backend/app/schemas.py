"""Pydantic schemas for API request/response payloads."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Built-in shot modes. `custom` lets sellers add free-form cuts on top.
ShotMode = Literal["lookbook", "front", "side", "back", "custom"]


class SessionCreated(BaseModel):
    sessionId: str
    createdAt: datetime


class AnalyzeOut(BaseModel):
    sessionId: str
    inputImageUrl: str = Field(..., description="Time-limited SAS URL of the uploaded input image.")
    promptMd: str = Field(..., description="Markdown Output_Prompt produced by the analysis model.")
    model: str
    analyzedAt: datetime


class PromptUpdateIn(BaseModel):
    promptMd: str = Field(..., min_length=1, description="Human-reviewed Output_Prompt.")


class PromptUpdateOut(BaseModel):
    sessionId: str
    promptMd: str
    updatedAt: datetime


class StyleHeaderInfo(BaseModel):
    """Default style header for a built-in shot mode."""

    mode: ShotMode
    label: str
    description: str
    header: str
    useReference: bool
    sceneCompose: bool


class GenerateItem(BaseModel):
    """A single shot to render in this generate call.

    - `mode`: built-in mode (lookbook/front/side/back) or `custom`.
    - `label`: display name (required for `custom`, optional for built-ins).
    - `promptHeader`: user-editable style header. If omitted on a built-in
      mode, the server falls back to that mode's default header. Required
      when `mode == "custom"`.
    - `useReference`: whether the input photo should anchor generation via
      `images.edit`. Defaults to the mode's default (all built-ins default True).
    - `sceneCompose`: when True the model is told to compose a new scene
      around the product (model · pose · background). Lowers image fidelity
      and reframes the analysis prompt as "외형 참고용". Defaults to the mode's
      default (lookbook=True, others=False; for custom defaults to False).
    - `includeAnalysisPrompt`: whether the session's analysis prompt is
      appended to the style header before sending to the model. Default True.
    """

    mode: ShotMode
    label: str | None = None
    promptHeader: str | None = None
    useReference: bool | None = None
    sceneCompose: bool | None = None
    includeAnalysisPrompt: bool = True


class GenerateIn(BaseModel):
    items: list[GenerateItem] = Field(
        ...,
        min_length=1,
        max_length=8,
        description="Shots to render in parallel. Results are appended to the session history.",
    )


# ---- Job (async) ---------------------------------------------------------

JobStatus = Literal["running", "done", "partial", "failed"]
JobItemStatus = Literal["pending", "running", "done", "failed"]


class GenerateJobItem(BaseModel):
    tempId: str = Field(..., description="Stable id of this item inside the job (not the generation id).")
    mode: ShotMode
    label: str
    status: JobItemStatus
    generationId: str | None = Field(None, description="Set once the image lands in `generations[]`.")
    error: str | None = None


class GenerateJobLogEntry(BaseModel):
    ts: datetime
    tempId: str | None = None
    label: str | None = None
    message: str


class GenerateJobOut(BaseModel):
    """Returned by `POST /generate` (202) and `GET /generate/jobs/{jobId}`.

    `gpt-image-2` calls can take 1~5 minutes per shot, so the API is async:
    the POST returns immediately with a job id and the client polls this
    endpoint until `status` is no longer `"running"`. New images are appended
    to `session.generations` as they complete.
    """

    sessionId: str
    jobId: str
    status: JobStatus
    items: list[GenerateJobItem]
    logs: list[GenerateJobLogEntry] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime


class GenerationResult(BaseModel):
    id: str = Field(..., description="Stable id of this generated image inside the session.")
    mode: ShotMode
    label: str
    imageUrl: str = Field(..., description="Time-limited SAS URL of the generated image.")
    promptHeader: str = Field("", description="Style header that was used (without the analysis prompt).")
    usedPrompt: str = Field("", description="Full prompt sent to gpt-image-2 (header + analysis prompt).")
    createdAt: datetime


class GenerateOut(BaseModel):
    sessionId: str
    results: list[GenerationResult]


class SessionView(BaseModel):
    sessionId: str
    createdAt: datetime
    updatedAt: datetime
    inputImageUrl: str | None = None
    promptMd: str | None = None
    generations: list[GenerationResult] = []
    jobs: list[GenerateJobOut] = []


class SessionListItem(BaseModel):
    """Read-only gallery item — one card on the history page.

    All URLs are time-limited SAS URLs refreshed at read time. No write
    fields are exposed; the gallery is purely a Cosmos query result.
    """

    sessionId: str
    createdAt: datetime
    updatedAt: datetime
    inputImageUrl: str | None = None
    promptMd: str | None = None
    generations: list[GenerationResult] = []


class SessionList(BaseModel):
    items: list[SessionListItem]
