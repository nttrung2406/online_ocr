"""Generate small sample documents for the browser smoke test (PNG, 2-page PDF, DOCX with image)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import docx
from docx.shared import Inches

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)

def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

img = Image.new("RGB", (900, 420), "white")
d = ImageDraw.Draw(img)
d.text((40, 30), "Invoice #2026-117", fill="black", font=font(40))
d.text((40, 110), "Item            Qty     Price", fill="black", font=font(26))
d.text((40, 160), "Widget A          2     $19.90", fill="black", font=font(26))
d.text((40, 210), "Widget B          1      $5.00", fill="black", font=font(26))
d.text((40, 290), "Total: $44.80", fill="black", font=font(32))
img.save(out / "sample.png")

c = canvas.Canvas(str(out / "sample.pdf"), pagesize=A4)
for n in (1, 2):
    c.setFont("Helvetica-Bold", 22)
    c.drawString(72, 760, f"Quarterly Report - Page {n}")
    c.setFont("Helvetica", 12)
    c.drawString(72, 730, "Revenue grew 12% year over year, driven by browser-side products.")
    c.showPage()
c.save()

doc = docx.Document()
doc.add_heading("Meeting Notes", level=1)
doc.add_paragraph("Decision: ship the browser-only OCR beta on Friday.")
doc.add_picture(str(out / "sample.png"), width=Inches(4))
doc.save(out / "sample.docx")
print("fixtures written to", out)
