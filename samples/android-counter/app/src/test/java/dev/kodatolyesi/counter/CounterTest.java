package dev.kodatolyesi.counter;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public final class CounterTest {
    @Test
    public void incrementIncreasesValueAndRetainsState() {
        Counter counter = new Counter();
        assertEquals(1, counter.increment());
        assertEquals(1, counter.value());
        assertEquals(2, counter.increment());
    }
}
