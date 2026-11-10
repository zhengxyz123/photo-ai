#!/usr/bin/env bash
# Download the two upstream PyTorch checkpoints into tools/.work and verify
# their SHA-256.  Everything under .work is an intermediate input; the
# converted runtime models live in public/models.
set -euo pipefail

cd "$(dirname "$0")"
TARGET="${1:-all}"
WORK="$PWD/.work"
mkdir -p "$WORK"

fetch() {
    local url="$1" file="$2" want="$3" label="$4"
    if [ -f "$file" ]; then
        local got
        got="$(sha256sum "$file" | awk '{print $1}')"
        if [ "$got" = "$want" ]; then
            echo "already downloaded: $label  ($file)"
            return 0
        fi
        echo "wrong SHA-256 for $label, re-downloading" >&2
        rm -f "$file"
    fi
    echo "downloading $label"
    echo "  $url"
    curl -L --fail --retry 5 --retry-delay 3 -o "$file" "$url"
    echo "$want  $file" | sha256sum -c -
}

if [ "$TARGET" = "all" ] || [ "$TARGET" = "sam" ]; then
    fetch \
        'https://www.modelscope.cn/models/PAI/MobileSAM/resolve/master/mobile_sam.pt' \
        "$WORK/mobile_sam.pt" \
        '6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f' \
        'MobileSAM checkpoint'
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "lama" ]; then
    fetch \
        'https://www.modelscope.cn/models/iic/cv_fft_inpainting_lama/resolve/master/pytorch_model.pt' \
        "$WORK/pytorch_model.pt" \
        '0588a53bcbca8e059b6964b715aaff5ee63916af29c41406e108bd91e45dc820' \
        'LaMa checkpoint'
fi

ls -lh "$WORK"/*.pt
