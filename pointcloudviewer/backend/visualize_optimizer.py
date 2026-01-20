# backend/visualize_optimizer.py

import sys
import os
import glob
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QPushButton, QScrollArea, QLabel, 
                             QGridLayout, QSpinBox, QDoubleSpinBox, QFrame)
from PyQt6.QtGui import QPixmap, QImage
from PyQt6.QtCore import Qt, QSize

# Import logic
from view_optimizer import calculate_view_redundancy, calculate_coverage_redundancy, load_camera_data_from_npy

# SETTINGS
# Get the directory where this script (visualize_optimizer.py) lives
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Points to backend/example_scene
SCENE_DIR = os.path.join(BASE_DIR, "example_scene") 
IMAGES_DIR = os.path.join(SCENE_DIR, "images")
EXTRINSICS_FILE = os.path.join(SCENE_DIR, "camera_extrinsics.npy")
INTRINSICS_FILE = os.path.join(SCENE_DIR, "camera_intrinsics.npy")
POINTS_FILE = os.path.join(SCENE_DIR, "sparse", "points3D.txt")

class ImageCard(QWidget):
    def __init__(self, image_path, index):
        super().__init__()
        self.index = index
        self.image_path = image_path
        self.is_kept = True
        
        self.layout = QVBoxLayout()
        self.layout.setContentsMargins(5, 5, 5, 5)
        self.setLayout(self.layout)
        
        # Image Label
        self.img_label = QLabel()
        self.img_label.setFixedSize(150, 100)
        self.img_label.setStyleSheet("background-color: #333; border-radius: 4px;")
        self.img_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.layout.addWidget(self.img_label)
        
        # Text Label
        self.text_label = QLabel(f"{index}: {os.path.basename(image_path)}")
        self.text_label.setStyleSheet("color: white; font-size: 10px;")
        self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.layout.addWidget(self.text_label)
        
        # Load thumbnail immediately
        self.load_thumbnail()

    def load_thumbnail(self):
        if os.path.exists(self.image_path):
            pixmap = QPixmap(self.image_path)
            scaled = pixmap.scaled(150, 100, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation)
            self.img_label.setPixmap(scaled)
        else:
            self.img_label.setText("Missing")

    def set_status(self, kept: bool):
        self.is_kept = kept
        if kept:
            # Opaque (Selected)
            self.setWindowOpacity(1.0)
            self.img_label.setStyleSheet("border: 2px solid #00ff00; background-color: #333;") # Green border
            self.text_label.setStyleSheet("color: #00ff00; font-weight: bold;")
            self.setEnabled(True)
        else:
            # Transparent / Dimmed (Rejected)
            # We can't easily set opacity on widget without window flags, 
            # so we use QGraphicsEffect OR just style sheets.
            # Simplest way to "dim" is disable + red border.
            self.img_label.setStyleSheet("border: 2px solid #ff0000; opacity: 0.3;") 
            self.text_label.setStyleSheet("color: #666;")
            self.setEnabled(False) # This grays it out visually in Qt

class OptimizerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("View Optimizer Debugger")
        self.resize(1000, 800)
        self.setStyleSheet("background-color: #1e1e1e;")
        
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        
        # 1. Controls Area
        controls_layout = QHBoxLayout()
        
        self.mode_btn = QPushButton("Mode: Geometric")
        self.mode_btn.setCheckable(True)
        self.mode_btn.toggled.connect(self.toggle_mode)
        controls_layout.addWidget(self.mode_btn)
        
        self.dist_spin = QDoubleSpinBox()
        self.dist_spin.setPrefix("Dist: ")
        self.dist_spin.setValue(1.5)
        self.dist_spin.setSingleStep(0.1)
        self.dist_spin.setStyleSheet("background-color: white; color: black;")
        
        self.angle_spin = QDoubleSpinBox()
        self.angle_spin.setPrefix("Angle: ")
        self.angle_spin.setValue(15.0)
        self.angle_spin.setMaximum(180.0)
        self.angle_spin.setStyleSheet("background-color: white; color: black;")
        
        self.run_btn = QPushButton("Run Optimizer")
        self.run_btn.setStyleSheet("background-color: #007acc; color: white; font-weight: bold; padding: 5px;")
        self.run_btn.clicked.connect(self.run_optimizer)
        
        self.stats_label = QLabel("Ready.")
        self.stats_label.setStyleSheet("color: white; margin-left: 10px;")

        controls_layout.addWidget(self.dist_spin)
        controls_layout.addWidget(self.angle_spin)
        controls_layout.addWidget(self.run_btn)
        controls_layout.addWidget(self.stats_label)
        controls_layout.addStretch()
        
        layout.addLayout(controls_layout)
        
        # 2. Scroll Area for Images
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        layout.addWidget(scroll)
        
        grid_widget = QWidget()
        scroll.setWidget(grid_widget)
        self.grid = QGridLayout(grid_widget)
        self.grid.setSpacing(10)
        
        # 3. Load Data
        self.image_cards = []
        self.load_data()

    def load_data(self):
        # Get images
        image_files = sorted(glob.glob(os.path.join(IMAGES_DIR, "*")))
        valid_exts = ['.jpg', '.jpeg', '.png']
        image_files = [f for f in image_files if os.path.splitext(f)[1].lower() in valid_exts]
        
        if not image_files:
            self.stats_label.setText(f"No images found in {IMAGES_DIR}")
            return

        # Create Grid
        cols = 5
        for i, img_path in enumerate(image_files):
            card = ImageCard(img_path, i)
            self.image_cards.append(card)
            self.grid.addWidget(card, i // cols, i % cols)
            
        self.stats_label.setText(f"Loaded {len(image_files)} images. Load extrinsics...")
        
        # Load Extrinsics
        self.cameras = load_camera_data_from_npy(EXTRINSICS_FILE)
        
        if len(self.cameras) != len(image_files):
             self.stats_label.setText(f"WARNING: Cam count ({len(self.cameras)}) != Image count ({len(image_files)})")
        else:
             self.stats_label.setText(f"Loaded {len(image_files)} images and cameras.")
             
    def toggle_mode(self, checked):
        if checked:
            self.mode_btn.setText("Mode: Coverage (Robust)")
            self.dist_spin.setEnabled(False)
            self.angle_spin.setEnabled(False)
        else:
            self.mode_btn.setText("Mode: Geometric (Fast)")
            self.dist_spin.setEnabled(True)
            self.angle_spin.setEnabled(True)

    def run_optimizer(self):
        if not self.cameras:
            return

        if self.mode_btn.isChecked():
            # Coverage Logic
            if not os.path.exists(POINTS_FILE):
                self.stats_label.setText("Error: points3D.txt not found.")
                return
            
            self.stats_label.setText("Running Coverage Optimization...")
            QApplication.processEvents()
            
            # Pass INTRINSICS_FILE here
            # Note: You might want to read actual image size from the first loaded image card?
            # For now, assuming standard 4032x3024 is risky if your images are different.
            # Better to grab it from the first image if it exists.
            img_w, img_h = 4032, 3024 
            if self.image_cards:
                pix = QPixmap(self.image_cards[0].image_path)
                if not pix.isNull():
                    img_w, img_h = pix.width(), pix.height()

            kept_indices = calculate_coverage_redundancy(
                self.cameras, 
                POINTS_FILE, 
                INTRINSICS_FILE, 
                max_cameras=None,
                img_size=(img_w, img_h)
            )
        else:
            # Run Geometric Logic
            dist = self.dist_spin.value()
            angle = self.angle_spin.value()
            
            # Run Logic
            kept_indices = calculate_view_redundancy(self.cameras, dist_threshold=dist, angle_threshold_deg=angle)
            
        # Update UI
        count_kept = 0
        kept_set = set(kept_indices)
        for card in self.image_cards:
            if card.index in kept_set:
                card.set_status(True)
                count_kept += 1
            else:
                card.set_status(False)
                
        self.stats_label.setText(f"Kept {count_kept} / {len(self.image_cards)} images.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = OptimizerWindow()
    window.show()
    sys.exit(app.exec())