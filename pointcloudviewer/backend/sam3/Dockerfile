FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    VENV_PATH=/opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    git ca-certificates curl \
    libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv $VENV_PATH
ENV PATH="$VENV_PATH/bin:$PATH"

RUN python -m pip install --upgrade pip

# ✅ PyTorch with CUDA 12.8 (cu128) — needed for SM120/Blackwell support
RUN python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
# PyTorch documents cu128 installs, and notes 2.7+ with CUDA 12.8 upgrades components for Blackwell platforms :contentReference[oaicite:2]{index=2}

WORKDIR /workspace

COPY requirements.txt /workspace/requirements.txt
RUN python -m pip install -r /workspace/requirements.txt

COPY sam3 /workspace/sam3
RUN python -m pip install -e "/workspace/sam3[notebooks]"

COPY app /workspace/app

ENTRYPOINT ["python", "/workspace/app/infer_folder.py"]
