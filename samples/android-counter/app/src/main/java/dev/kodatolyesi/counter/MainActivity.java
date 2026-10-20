package dev.kodatolyesi.counter;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private final Counter counter = new Counter();
    private TextView countLabel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        countLabel = findViewById(R.id.count_label);
        Button increment = findViewById(R.id.increment_button);
        increment.setOnClickListener(view ->
                countLabel.setText(getString(R.string.count_value, counter.increment())));
    }
}
