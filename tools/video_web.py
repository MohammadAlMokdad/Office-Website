# Screen recordings -> web video (H.264 MP4, no sound) with Blender's own FFmpeg, colours untouched.
#   blender -b --factory-startup -P tools/video_web.py -- <in.mp4> <out.mp4> <width> [quality: HIGH|MEDIUM|LOW]
#       [crop_top crop_bottom]   (source pixels: black bands recorded around the desktop)
import bpy, sys
args = sys.argv[sys.argv.index("--") + 1:]
src, out, width = args[:3]
quality = args[3] if len(args) > 3 else "MEDIUM"
crop_top, crop_bottom = (int(args[4]), int(args[5])) if len(args) > 5 else (0, 0)
clip = bpy.data.movieclips.load(src)
w, h = clip.size; fps = clip.fps; n = clip.frame_duration
h_in = h - crop_top - crop_bottom
W = int(width) // 2 * 2; H = round(h_in * W / w / 2) * 2
sc = bpy.context.scene
ed = sc.sequence_editor_create()
strips = ed.strips if hasattr(ed, "strips") else ed.sequences
s = strips.new_movie("rec", src, channel=1, frame_start=1)
s.crop.max_y, s.crop.min_y = crop_top, crop_bottom   # VSE crop: max_y = top, min_y = bottom
s.transform.scale_x = s.transform.scale_y = W / w
s.transform.offset_y = (crop_top - crop_bottom) / 2 * W / w     # keep the kept rows centred in the frame
sc.frame_start, sc.frame_end = 1, s.frame_final_duration
sc.render.fps, sc.render.fps_base = round(fps), 1
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
sc.view_settings.exposure = 0; sc.view_settings.gamma = 1
sc.render.use_sequencer = True; sc.render.use_compositing = False
im = sc.render.image_settings
if hasattr(im, "media_type"):                        # Blender 5: video output is its own media type
    im.media_type = "VIDEO"
im.file_format = "FFMPEG"
ff = sc.render.ffmpeg
ff.format = "MPEG4"; ff.codec = "H264"; ff.constant_rate_factor = quality; ff.ffmpeg_preset = "GOOD"
ff.gopsize = round(fps) * 2; ff.audio_codec = "NONE"
sc.render.filepath = out
bpy.ops.render.render(animation=True)
print(f"VIDEO {src} {w}x{h} -> {out} {W}x{H}, {s.frame_final_duration} frames at {fps} fps")
