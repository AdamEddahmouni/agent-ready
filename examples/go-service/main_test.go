package main

import "testing"

func TestGreeting(t *testing.T) {
	if got := greeting(); got != "ok" {
		t.Errorf("greeting() = %q, want %q", got, "ok")
	}
}
