Flash Recorder bundles FFmpeg as an external tool to perform media processing.

Version: 8.0.x (static build)
Origin: Public FFmpeg builds (e.g., gyan.dev full build)

License and Compliance:
- FFmpeg is licensed under LGPL/GPL depending on build options.
- This bundled binary was built with --enable-gpl, and is distributed under GNU GPL terms.
- The application invokes FFmpeg as an external process; it is not linked to FFmpeg libraries.
- For full license text and details, see:
  * FFmpeg license overview: https://ffmpeg.org/legal.html
  * GNU GPLv3 text: https://www.gnu.org/licenses/gpl-3.0.txt
  * GNU LGPLv2.1 text: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt

Source Code Availability:
- FFmpeg source code and build information are publicly available from the FFmpeg project.
- If this distribution requires providing source upon request, please refer users to https://ffmpeg.org/ and the build provider’s source disclosure.

Third-Party Notices:
- FFmpeg includes codecs and libraries with their own licenses. Refer to FFmpeg’s documentation for per-library licensing.

Usage:
- FFmpeg is executed via a relative path (resources/ffmpeg/ffmpeg.exe on Windows).
- No system PATH or external installation is required for normal operation.

