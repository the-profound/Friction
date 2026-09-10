---
name: Expo native signed uploads
description: Reliable direct object-storage uploads for files selected by Expo native pickers.
---

On iOS and Android, keep the picker-provided local URI, byte size, and MIME type as native upload state. Send the file with Expo File.upload using PUT and binary-content mode. Keep browser File/Blob uploads as a separate web path. Do not normalize native picker URIs through fetch(uri).blob().

**Why:** Native picker URIs are local/provider resources, not ordinary network URLs. Converting them through fetch can fail depending on iOS asset/provider behavior even when the selected image bytes are valid.

**How to apply:** Use this for signed uploads from Expo image/document pickers. Test the adapter's exact URI, PUT method, binary mode, and Content-Type, then run server-side size and signature verification on the uploaded bytes.