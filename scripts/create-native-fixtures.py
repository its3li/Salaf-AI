"""Small non-personal fixtures for image and scanned-PDF native input tests."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

directory = Path('test-results/native-validation')
directory.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (900, 400), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 42)
draw.text((45, 80), 'LOCAL ATTACHMENT TEST', fill='black', font=font)
draw.text((45, 160), 'Document code: CEDAR-742', fill='black', font=font)
draw.text((45, 240), 'Topic: kindness and patience', fill='black', font=font)
image.save(directory / 'note.jpg', quality=90)
# Pillow writes image-only pages: pdf.js cannot extract the code as text from this PDF.
image.save(directory / 'scanned-note.pdf', 'PDF', resolution=100)
for filename, code in [('second.jpg', 'OLIVE-913'), ('third.jpg', 'PALM-285')]:
    page = Image.new('RGB', (900, 400), 'white')
    painter = ImageDraw.Draw(page)
    painter.text((45, 80), 'LOCAL ATTACHMENT TEST', fill='black', font=font)
    painter.text((45, 160), f'Document code: {code}', fill='black', font=font)
    painter.text((45, 240), 'Topic: kindness and patience', fill='black', font=font)
    page.save(directory / filename, quality=90)
print('Created image and image-only PDF fixtures (no personal data).')
content = b'BT /F1 22 Tf 72 700 Td (Document code: CEDAR-742) Tj ET'
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream']
pdf = b'%PDF-1.4\n'; offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(pdf)); pdf += str(index).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
xref = len(pdf)
pdf += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
pdf += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
(directory / 'text-note.pdf').write_bytes(pdf)
