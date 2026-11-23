#!/bin/sh
# Deploy conversation-api to the cluster KUBECONFIG points at (mf-dev): the code as the
# conversation-api-code ConfigMap, then k8s.yaml, then a restart so the pod reads the new code.
#
#   KUBECONFIG=kubeconfig/kube_config_mf_dev.yaml pkg/dev-extension/conversation-mode/server/deploy.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
NS=dev-system

kubectl -n "$NS" create configmap conversation-api-code \
  --from-file=server.mjs="$HERE/server.mjs" \
  --from-file=github.mjs="$HERE/github.mjs" \
  --from-file=ws.mjs="$HERE/ws.mjs" \
  --from-file=projects.mjs="$HERE/../projects.mjs" \
  --from-file=pickup.mjs="$HERE/../pickup.mjs" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$HERE/k8s.yaml"
kubectl -n "$NS" rollout restart deploy/conversation-api
kubectl -n "$NS" rollout status deploy/conversation-api --timeout=180s
