package dev.kodatolyesi.counter;

public final class Counter {
    private int value;

    public int increment() {
        return ++value;
    }

    public int value() {
        return value;
    }
}
