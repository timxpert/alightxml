XML Canvas → Alight Motion probe

1. Copy ALL files in this folder to your phone's Download folder (directly in Download, not a subfolder):
   xmlcanvas-probe.xml, xmlcanvas-probe-b.png, xmlcanvas-probe-d.png, 7437fad231526949271c377c7e115de1.png
2. In Alight Motion, import xmlcanvas-probe.xml.
3. Report what you see:
   - Which lettered images show: A, B, C, D (and whether the app asks to replace missing media)
   - Do the title and the labels show as text? Correct size/position?
   - E: is there a yellow ellipse? F: is there a purple→orange gradient bar?
   - Is everything centred where expected (2×2 grid of images)?

What each tests:
  A  am-internal:///7437fad231526949271c377c7e115de1.png  (packaged media name, what XML Canvas exports now)
  B  file:///storage/emulated/0/Download/xmlcanvas-probe-b.png
  C  content://media/external/images/media/143949  (your own picture-ok.png from the real export; control)
  D  xmlcanvas-probe-d.png  (bare file name next to the XML)
