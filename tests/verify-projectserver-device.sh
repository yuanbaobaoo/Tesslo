#!/bin/zsh
# ProjectServer 真机验收：经 hdc fport 直打 127.0.0.1:20117 全端点。
# 前提：应用已前台运行（aa start），fport 已建立。
set -u
BASE='http://127.0.0.1:20117'
PASS=0; FAIL=0

check() {  # check <名称> <期待子串> <响应>
  local name="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then
    PASS=$((PASS+1)); print "✔ $name"
  else
    FAIL=$((FAIL+1)); print "✖ $name（期待含 \"$want\"，实际：${got:0:200}）"
  fi
}

jqget() { # jqget <json> <key> —— 无 jq 时用 python 兜底
  print "$1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d$2)" 2>/dev/null
}

# 1. 空库列表
R=$(curl -s --max-time 8 "$BASE/projects")
check 'GET /projects（空库）' '"ok":true' "$R"

# 2. 新建（默认库位置）
R=$(curl -s --max-time 8 -X POST "$BASE/projects" -H 'Content-Type: application/json' -d '{"name":"真机验收A"}')
check 'POST /projects 新建' '真机验收A' "$R"
ID=$(jqget "$R" "['data']['id']")
print "  → id=$ID"

# 3. 未保存的读 → E_DIR_MISSING（web 侧默认项目回落依据）
R=$(curl -s --max-time 8 "$BASE/projects/$ID")
check 'GET /projects/:id（未保存 → E_DIR_MISSING）' 'E_DIR_MISSING' "$R"

# 4. 保存 .tess（最小 zip：手写一个 store 版空壳，只验证服务端 IO 链路）
ZIPB64=$(python3 - <<'PY'
import base64, io, zipfile, struct, time
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:
    z.writestr('tesslo.json', '{"formatVersion":1,"projectId":"dev-test","name":"真机验收A","createdAt":"2026-11-17T00:00:00Z","updatedAt":"2026-11-17T00:00:00Z","thumbnail":null}')
    z.writestr('project.json', '{"targets":[]}')
print(base64.b64encode(buf.getvalue()).decode())
PY
)
R=$(curl -s --max-time 15 -X PUT "$BASE/projects/$ID" -H 'Content-Type: application/json' \
  -d "{\"tessBase64\":\"$ZIPB64\"}")
check 'PUT /projects/:id 保存' '"ok":true' "$R"

# 5. 再读 → 有字节（base64 非空）
R=$(curl -s --max-time 8 "$BASE/projects/$ID")
check 'GET /projects/:id（已保存）' 'tessBase64' "$R"

# 6. 再保存一次 → 旧版转存快照
R=$(curl -s --max-time 15 -X PUT "$BASE/projects/$ID" -H 'Content-Type: application/json' \
  -d "{\"tessBase64\":\"$ZIPB64\"}")
R=$(curl -s --max-time 8 "$BASE/projects/$ID/snapshots")
check 'GET /projects/:id/snapshots（保存后 ≥1）' 'savedAt' "$R"
SNAP=$(jqget "$R" "['data'][0]['id']")

# 7. 回滚快照
if [[ -n "$SNAP" ]]; then
  R=$(curl -s --max-time 8 -X POST "$BASE/projects/$ID/snapshots/$SNAP/restore")
  check 'POST restore' '"ok":true' "$R"
else
  print "✖ 快照 id 缺失，跳过回滚"; FAIL=$((FAIL+1))
fi

# 8. 重命名 + 收藏
R=$(curl -s --max-time 8 -X PUT "$BASE/projects/$ID/meta" -H 'Content-Type: application/json' -d '{"name":"真机验收B","favorite":true}')
check 'PUT meta 重命名+收藏' '真机验收B' "$R"

# 9. 复制
R=$(curl -s --max-time 8 -X POST "$BASE/projects/$ID/duplicate" -H 'Content-Type: application/json' -d '{"newName":"真机验收B副本"}')
check 'POST duplicate' '真机验收B副本' "$R"
DUP=$(jqget "$R" "['data']['id']")

# 10. 删除（副本；不连目录）
if [[ -n "$DUP" ]]; then
  R=$(curl -s --max-time 8 -X DELETE "$BASE/projects/$DUP}?x=1" 2>/dev/null)
  R=$(curl -s --max-time 8 -X DELETE "$BASE/projects/$DUP")
  check 'DELETE 副本' '"ok":true' "$R"
fi

# 11. 未知路由 → E_UNSUPPORTED
R=$(curl -s --max-time 8 "$BASE/no-such-route")
check '404 路由' 'E_UNSUPPORTED' "$R"

# 12. .. 逃逸拦截
R=$(curl -s --max-time 8 "$BASE/projects/..%2Fescape")
check '路径逃逸拦截' 'rejected' "$R"

print ""
print "结果：$PASS 通过 / $FAIL 失败"
exit $((FAIL > 0))
