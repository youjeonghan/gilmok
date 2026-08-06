// 길목(gilmok) — 씬 플로우 맵 로컬 서버 (단일 바이너리)
// 사용: gilmok-server [데이터폴더]   (데이터폴더 생략 시 현재 폴더)
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

//go:embed web
var webFS embed.FS

//go:embed skills/flow-sync/SKILL.md
var skillMD []byte

const version = "7.0.0"

func main() {
	port := flag.Int("port", 8123, "포트")
	noOpen := flag.Bool("no-open", false, "브라우저 자동 열기 끄기")
	showVersion := flag.Bool("version", false, "버전 출력")
	flag.Parse()
	if *showVersion {
		fmt.Println("길목 v" + version)
		return
	}

	dataDir := "."
	if flag.NArg() > 0 {
		dataDir = flag.Arg(0)
	}
	absData, err := filepath.Abs(dataDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "데이터 폴더 경로 오류:", err)
		os.Exit(1)
	}
	if st, err := os.Stat(absData); err != nil || !st.IsDir() {
		fmt.Fprintln(os.Stderr, "데이터 폴더가 없습니다:", absData)
		os.Exit(1)
	}
	if _, err := os.Stat(filepath.Join(absData, "flow.json")); err != nil {
		fmt.Println("주의: flow.json이 없습니다 —", absData)
	}

	webSub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.Handle("/", noStore(http.FileServer(http.FS(webSub))))
	mux.Handle("/data/", noStore(http.StripPrefix("/data/", http.FileServer(http.Dir(absData)))))

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"version":        version,
			"dataDir":        absData,
			"projectKey":     absData,
			"skillInstalled": skillInstalled(absData),
		})
	})

	mux.HandleFunc("/api/flow", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
		if err != nil || !json.Valid(body) {
			writeJSON(w, map[string]any{"ok": false, "error": "invalid json"})
			return
		}
		if err := os.WriteFile(filepath.Join(absData, "flow.json"), body, 0o644); err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("/api/install-skill", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		dest := skillDest(absData)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if err := os.WriteFile(dest, skillMD, 0o644); err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true, "path": dest})
	})

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	url := "http://" + addr + "/"
	fmt.Printf("길목 v%s\n  데이터: %s\n  주소:   %s\n", version, absData, url)
	if !*noOpen {
		openBrowser(url)
	}
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func noStore(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

// 데이터 폴더에서 위로 올라가며 .git이 있는 프로젝트 루트를 찾는다.
// 없으면 홈의 글로벌 스킬 폴더(~/.claude)를 대상으로 한다.
func projectRoot(dataDir string) (string, bool) {
	d := dataDir
	for {
		if st, err := os.Stat(filepath.Join(d, ".git")); err == nil && st.IsDir() {
			return d, true
		}
		parent := filepath.Dir(d)
		if parent == d {
			home, err := os.UserHomeDir()
			if err != nil {
				return dataDir, false
			}
			return home, false
		}
		d = parent
	}
}

func skillDest(dataDir string) string {
	root, _ := projectRoot(dataDir)
	return filepath.Join(root, ".claude", "skills", "flow-sync", "SKILL.md")
}

func skillInstalled(dataDir string) bool {
	_, err := os.Stat(skillDest(dataDir))
	return err == nil
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
