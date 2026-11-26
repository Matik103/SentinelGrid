from pathlib import Path
import cv2
import numpy as np

source = Path("apps/web/public/assets/sentinelgrid-logo.jpg")
image = cv2.imread(str(source), cv2.IMREAD_COLOR)
if image is None:
    raise SystemExit("Could not read source logo")
h, w = image.shape[:2]
mask = np.zeros((h + 2, w + 2), np.uint8)
# The JPEG has a uniform deep-navy canvas. Flood only background-connected pixels,
# preserving the enclosed dark-blue artwork inside the shield.
for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
    cv2.floodFill(image.copy(), mask, seed, (0, 0, 0), (30, 30, 30), (30, 30, 30), flags=4 | (255 << 8))
alpha = mask[1:-1, 1:-1].copy()
# Flood-filled pixels become 255; invert to make the outside transparent.
alpha = 255 - alpha
alpha = cv2.GaussianBlur(alpha, (3, 3), 0.65)
rgba = cv2.cvtColor(cv2.imread(str(source), cv2.IMREAD_COLOR), cv2.COLOR_BGR2BGRA)
rgba[:, :, 3] = alpha
out = Path("apps/web/public/assets/sentinelgrid-logo.png")
cv2.imwrite(str(out), rgba)
print(f"Wrote {out} ({w}x{h}), transparent pixels: {int((alpha == 0).sum())}")
