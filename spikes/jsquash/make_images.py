"""Generate 1000x1000 RGBA test PNGs for the jSquash spike (stdlib only)."""
import math, os, random, struct, zlib

W = H = 1000
random.seed(42)

def write_png(path, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * W * 4:(y + 1) * W * 4]) for y in range(H))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"{path}: {len(png) / 1024:.0f} KB")

def stamp_strokes(rgba, strokes, background=None):
    if background:
        for i in range(W * H):
            rgba[i * 4:i * 4 + 4] = bytes(background)
    for _ in range(strokes):
        r, g, b = (random.randrange(256) for _ in range(3))
        a = random.choice([255, 255, 160, 90])
        size = random.randint(3, 40)
        x, y = random.uniform(0, W), random.uniform(0, H)
        angle = random.uniform(0, math.tau)
        for _ in range(random.randint(30, 120)):
            angle += random.uniform(-0.4, 0.4)
            x = min(max(x + math.cos(angle) * size * 0.4, 0), W - 1)
            y = min(max(y + math.sin(angle) * size * 0.4, 0), H - 1)
            rad = size / 2
            for py in range(int(max(0, y - rad)), int(min(H, y + rad + 1))):
                for px in range(int(max(0, x - rad)), int(min(W, x + rad + 1))):
                    if (px - x) ** 2 + (py - y) ** 2 <= rad * rad:
                        i = (py * W + px) * 4
                        da = rgba[i + 3] / 255
                        sa = a / 255
                        oa = sa + da * (1 - sa)
                        for c, v in enumerate((r, g, b)):
                            rgba[i + c] = round((v * sa + rgba[i + c] * da * (1 - sa)) / oa) if oa else 0
                        rgba[i + 3] = round(oa * 255)

os.makedirs("images", exist_ok=True)

# Realistic: opaque white background with 40 strokes (what the app's canvas sends).
typical = bytearray(W * H * 4)
stamp_strokes(typical, 40, background=(255, 255, 255, 255))
write_png("images/typical.png", typical)

# Sparse: a few strokes on a transparent background.
sparse = bytearray(W * H * 4)
stamp_strokes(sparse, 4)
write_png("images/sparse.png", sparse)

# Worst accepted input: noise tuned to land just under the 1.5 MB upload cap.
def noisy(fraction):
    buf = bytearray(b"\xff" * (W * H * 4))
    noise = os.urandom(W * H * 4)
    rnd = random.Random(7)
    for i in range(W * H):
        if rnd.random() < fraction:
            buf[i * 4:i * 4 + 4] = noise[i * 4:i * 4 + 4]
    return buf
write_png("images/noise_cap.png", noisy(0.29))

# Beyond the cap (rejected by the size check in the real app): pure noise, codec stress only.
write_png("images/noise_full.png", bytearray(os.urandom(W * H * 4)))
