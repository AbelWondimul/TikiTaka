import sys
from unittest.mock import MagicMock

# Must run before main.py is imported anywhere in the test session.
_fb_admin = MagicMock()
_fb_admin._apps = {}
sys.modules.setdefault('firebase_admin', _fb_admin)
sys.modules.setdefault('firebase_admin.firestore', MagicMock())
sys.modules.setdefault('firebase_admin.storage', MagicMock())

_fb_fns = MagicMock()
sys.modules.setdefault('firebase_functions', _fb_fns)
sys.modules.setdefault('firebase_functions.firestore_fn', MagicMock())
sys.modules.setdefault('firebase_functions.https_fn', MagicMock())
sys.modules.setdefault('firebase_functions.options', MagicMock())
sys.modules.setdefault('google.generativeai', MagicMock())
sys.modules.setdefault('fitz', MagicMock())
sys.modules.setdefault('PIL', MagicMock())
sys.modules.setdefault('PIL.Image', MagicMock())
sys.modules.setdefault('PIL.ImageDraw', MagicMock())
