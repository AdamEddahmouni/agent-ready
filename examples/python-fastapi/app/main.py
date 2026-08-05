from fastapi import FastAPI

app = FastAPI(title="python-fastapi-example")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
