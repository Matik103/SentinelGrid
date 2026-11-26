package buffer

import (
	"path/filepath"
	"testing"
)

func TestEnqueueListAck(t *testing.T) {
	dir := t.TempDir()
	st, err := New(filepath.Join(dir, "q"))
	if err != nil {
		t.Fatal(err)
	}
	e1, err := st.Enqueue([]byte(`{"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	e2, err := st.Enqueue([]byte(`{"a":2}`))
	if err != nil {
		t.Fatal(err)
	}
	list, err := st.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 got %d", len(list))
	}
	if list[0].ID != e1.ID || list[1].ID != e2.ID {
		t.Fatalf("order mismatch")
	}
	if err := st.MarkAttempt(e1.ID); err != nil {
		t.Fatal(err)
	}
	list, _ = st.List()
	if list[0].Attempts != 1 {
		t.Fatalf("attempts=%d", list[0].Attempts)
	}
	if err := st.Ack(e1.ID); err != nil {
		t.Fatal(err)
	}
	n, err := st.Len()
	if err != nil || n != 1 {
		t.Fatalf("len=%d err=%v", n, err)
	}
}

func TestNewRequiresDir(t *testing.T) {
	if _, err := New(""); err == nil {
		t.Fatal("expected error")
	}
}
