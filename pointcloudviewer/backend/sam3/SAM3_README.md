# SAM3 Docker Inference (GPU)

This repo runs `infer_folder.py` inside a CUDA-enabled Docker container using an NVIDIA GPU.

---

## Install Docker Desktop (Windows)

### 1) Install Docker Desktop
1. Download and install **Docker Desktop for Windows**.
2. Open Docker Desktop → **Settings** → **General**:
   -  Enable **Use the WSL 2 based engine**
3. If prompted, allow Docker Desktop to install/update WSL components.

### 2) Install NVIDIA GPU Driver
1. Install the latest **NVIDIA driver** for your GPU on Windows.
2. Reboot your PC after installation.

### 3) Verify GPU works inside Docker
Open **PowerShell** and run:
```powershell
docker run --rm --gpus all nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04 nvidia-smi

---

## Model files + Docker build

### 1) Download model files
Download `model.safetensors` and `sam3.pt` from:
`https://drive.google.com/drive/folders/1yjOR4jXehbSQQsE4FFwDzK2k7V1_XvAJ?usp=sharing`

Place both files in:
`sam3\sam3\sam3`

### 2) Expected folder structure
```
sam3/
  Dockerfile
  requirements.txt
  app/
  sam3/
    sam3/
        model.safetensors
        sam3.pt
```

### 3) Build the Docker image
From the folder that contains the `Dockerfile`:
```powershell
cd sam3
docker build -t sam3-folder:cu128 .
```
