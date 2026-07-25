import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info("Loading BGE-M3 model...")
    from FlagEmbedding import BGEM3FlagModel
    model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
    logger.info("BGE-M3 model loaded.")
    yield
    model = None


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    sparse: dict[str, float]


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    output = model.encode(
        [req.text],
        return_dense=False,
        return_sparse=True,
        return_colbert_vecs=False,
    )

    lexical_weights = output["lexical_weights"][0]

    tokenizer = model.tokenizer
    sparse: dict[str, float] = {}
    for token_id, weight in lexical_weights.items():
        word = tokenizer.decode([int(token_id)]).strip()
        if word:
            current = sparse.get(word, 0.0)
            if float(weight) > current:
                sparse[word] = float(weight)

    return EmbedResponse(sparse=sparse)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
