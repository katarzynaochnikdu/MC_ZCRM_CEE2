import math
import os

from PIL import Image, ImageDraw

ICON_SIZES = [16, 32, 48, 128]


def lerp(a, b, t):
    return int(a + (b - a) * t)


def draw_background(size):
    start = (26, 26, 46)
    end = (22, 33, 62)
    gradient = Image.new("RGBA", (size, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        color = tuple(lerp(start[i], end[i], t) for i in range(3)) + (255,)
        gradient.paste(color, [0, y, size, y + 1])

    mask = Image.new("L", (size, size), 0)
    draw_mask = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    draw_mask.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)

    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.paste(gradient, (0, 0), mask)
    return bg


def draw_gmail(draw: ImageDraw.ImageDraw, size: int):
    env_w = size * 0.32
    env_h = size * 0.22
    x = size * 0.1
    y = size * 0.39
    radius = size * 0.03

    draw.rounded_rectangle(
        [x, y, x + env_w, y + env_h], radius=radius, fill=(234, 67, 53)
    )
    draw.line(
        [(x, y + 3), (x + env_w / 2, y + env_h / 2), (x + env_w, y + 3)],
        fill=(255, 255, 255),
        width=max(1, int(size * 0.02)),
        joint="curve",
    )


def draw_zoho(draw: ImageDraw.ImageDraw, size: int):
    radius = size * 0.18
    center = (size * 0.78, size * 0.5)
    bbox = [
        center[0] - radius,
        center[1] - radius,
        center[0] + radius,
        center[1] + radius,
    ]
    draw.ellipse(bbox, fill=(245, 124, 0))

    stroke = max(1, int(size * 0.035))
    draw.line(
        [(bbox[0] + radius * 0.3, center[1] - radius * 0.4),
         (bbox[2] - radius * 0.3, center[1] - radius * 0.4),
         (bbox[0] + radius * 0.3, center[1] + radius * 0.4),
         (bbox[2] - radius * 0.3, center[1] + radius * 0.4)],
        fill=(255, 255, 255),
        width=stroke,
        joint="curve",
    )


def draw_arrows(draw: ImageDraw.ImageDraw, size: int):
    mid_y = size * 0.5
    arrow_len = size * 0.28
    arrow_gap = size * 0.07
    stroke = max(1, int(size * 0.04))

    # Right arrow (Gmail -> Zoho)
    draw.line(
        [(size * 0.38, mid_y - arrow_gap), (size * 0.62, mid_y - arrow_gap)],
        fill=(76, 175, 80),
        width=stroke,
    )
    draw.line(
        [(size * 0.58, mid_y - arrow_gap - stroke),
         (size * 0.62, mid_y - arrow_gap),
         (size * 0.58, mid_y - arrow_gap + stroke)],
        fill=(76, 175, 80),
        width=stroke,
        joint="curve",
    )

    # Left arrow (Zoho -> Gmail)
    draw.line(
        [(size * 0.62, mid_y + arrow_gap), (size * 0.38, mid_y + arrow_gap)],
        fill=(33, 150, 243),
        width=stroke,
    )
    draw.line(
        [(size * 0.42, mid_y + arrow_gap - stroke),
         (size * 0.38, mid_y + arrow_gap),
         (size * 0.42, mid_y + arrow_gap + stroke)],
        fill=(33, 150, 243),
        width=stroke,
        joint="curve",
    )


def render(size):
    img = draw_background(size)
    draw = ImageDraw.Draw(img)
    draw_gmail(draw, size)
    draw_zoho(draw, size)
    draw_arrows(draw, size)
    return img


def main():
    base_dir = os.path.dirname(__file__)
    for size in ICON_SIZES:
        img = render(size)
        target = os.path.join(base_dir, f"icon-{size}.png")
        img.save(target, format="PNG")
        print(f"Wygenerowano {target}")


if __name__ == "__main__":
    main()

