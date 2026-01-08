# Realtime Pointcloud Builder and Viewer

- **Backend** (`backend/`): Uses FastAPI endpoints and websockets to recieve images from the front end and pass them in order of reciept to VGGT-SLAM which performs inference to generate pointclouds from batches of images given a user defined batch size. Each batch pointcloud is sent back to the front end for viewing as it is created. 
- **Frontend** (`pointcloudviewer/`): Electron + React based viewer. Allows for direct viewing of ply, pcd, or glb files, the upload of numbered video frames, or live capturing from a connected camera. When uploading/streaming images they are sent, in order, to the backend API via websockets for processing.

## Setup

Clone and enter the repo:
```bash
git clone https://github.com/hoskerelab/pointcloud-builder-and-viewer.git
cd pointcloud-builder-and-viewer
```

Make sure the following dependencies are installed before continuing:

```bash
sudo apt-get install git python3-pip libboost-all-dev cmake gcc g++ unzip
```

## Backend Setup

Enter the backend folder:

```bash
cd backend
```

Create and activate a virtual python environment:

```bash
python3 -m venv viewerenv
source viewerenv/bin/activate
```

Install required libraries:

```bash
pip install -r requirements.txt
```

Enter the VGGT-SLAM folder and run the setup file:

```bash
cd VGGT-SLAM
./setup.sh
```

### VGGT-SLAM expects a model checkpoint
- Create a folder in the VGGT-SLAM directory named "checkpoints"
- Place the [checkpoint](https://drive.google.com/file/d/1EkYViED_VQEso0K4KWzE-f2CW9Wat09m/view?usp=sharing) in this folder


## Frontend Setup

#### Make sure [Node.js and npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) are installed.

Enter the frontend viewer directory:
```bash
cd pointcloudviewer
```

Install requried packages:
```bash
npm install
```

## Starting the viewer

From the `backend/` directory run:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
to begin hosting of the backend API.

Then from the `pointcloudviewer/` directory run:
```bash
npm start
```
The Electron-based application should appear.

## Using the Viewer

![Pointcloud Viewer Diagram](assets/ViewerDiagram.png)