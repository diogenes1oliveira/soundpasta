# mypy: disable-error-code=no-untyped-def

import io
import os
import shutil
import subprocess
import tempfile
import threading
import time
import typing
from uuid import uuid4

import numpy
import pytest
import soundfile  # type: ignore[import-untyped]

from soundpasta.device.models import InputDevice, OutputDevice, PipeType
from soundpasta.device.pulseaudio import PulseAudioDeviceManager

DTMF_FREQUENCIES = {
    "0": (941, 1336),
    "1": (697, 1209),
    "2": (697, 1336),
    "3": (697, 1477),
    "4": (770, 1209),
    "5": (770, 1336),
    "6": (770, 1477),
    "7": (852, 1209),
    "8": (852, 1336),
    "9": (852, 1477),
}


def generate_dtmf_tone_wav(
    output_path: str, digit: str, duration: float, sample_rate: int = 44100, leading_silence: float = 0.5
) -> None:
    """Generate a DTMF tone WAV file for a single digit."""
    freq1, freq2 = DTMF_FREQUENCIES[digit]
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        tone_path = tmp_file.name
    try:
        subprocess.run(
            [
                "sox",
                "-n",
                "-r",
                str(sample_rate),
                "-c",
                "2",
                "-b",
                "16",
                tone_path,
                "synth",
                str(duration),
                "sine",
                str(freq1),
                "sine",
                str(freq2),
            ],
            check=True,
        )
        if leading_silence > 0:
            silence_path = f"{tone_path}.silence.wav"
            subprocess.run(
                [
                    "sox",
                    "-n",
                    "-r",
                    str(sample_rate),
                    "-c",
                    "2",
                    "-b",
                    "16",
                    silence_path,
                    "synth",
                    str(leading_silence),
                    "sine",
                    "0",
                ],
                check=True,
            )
            subprocess.run(
                ["sox", "--combine", "concatenate", silence_path, tone_path, output_path],
                check=True,
            )
            cleanup_temp_files(silence_path)
        else:
            shutil.copy(tone_path, output_path)
    finally:
        cleanup_temp_files(tone_path)


def generate_dtmf_sequence_wav(
    output_path: str,
    digits: str,
    tone_duration: float,
    pause_duration: float,
    sample_rate: int = 44100,
    leading_silence: float = 0.5,
) -> None:
    """Generate a WAV file containing a sequence of DTMF tones with pauses."""
    tone_files = []
    if leading_silence > 0:
        silence_file = f"{output_path}.leading_silence.wav"
        tone_files.append(silence_file)
        subprocess.run(
            [
                "sox",
                "-n",
                "-r",
                str(sample_rate),
                "-c",
                "2",
                "-b",
                "16",
                silence_file,
                "synth",
                str(leading_silence),
                "sine",
                "0",
            ],
            check=True,
        )
    for i, digit in enumerate(digits):
        freq1, freq2 = DTMF_FREQUENCIES[digit]
        tone_file = f"{output_path}.tone{i}.wav"
        tone_files.append(tone_file)
        subprocess.run(
            [
                "sox",
                "-n",
                "-r",
                str(sample_rate),
                "-c",
                "2",
                "-b",
                "16",
                tone_file,
                "synth",
                str(tone_duration),
                "sine",
                str(freq1),
                "sine",
                str(freq2),
            ],
            check=True,
        )
        if i < len(digits) - 1:
            pause_file = f"{output_path}.pause{i}.wav"
            tone_files.append(pause_file)
            subprocess.run(
                [
                    "sox",
                    "-n",
                    "-r",
                    str(sample_rate),
                    "-c",
                    "2",
                    "-b",
                    "16",
                    pause_file,
                    "synth",
                    str(pause_duration),
                    "sine",
                    "0",
                ],
                check=True,
            )
    if len(tone_files) > 1:
        subprocess.run(
            ["sox", "--combine", "concatenate"] + tone_files + [output_path],
            check=True,
        )
    else:
        shutil.copy(tone_files[0], output_path)
    for f in tone_files:
        if os.path.exists(f):
            os.unlink(f)


def generate_sine_wave_wav(output_path: str, frequency: float, duration: float, sample_rate: int = 44100) -> None:
    """Generate a sine wave WAV file."""
    t = numpy.linspace(0, duration, int(sample_rate * duration), False)
    sine_wave = numpy.sin(2 * numpy.pi * frequency * t)
    soundfile.write(output_path, sine_wave, sample_rate)


def convert_wav_to_mono_8khz(input_path: str, output_path: str) -> None:
    """Convert a WAV file to mono 8kHz format for DTMF detection."""
    subprocess.run(
        ["sox", input_path, "-r", "8000", "-c", "1", output_path],
        check=True,
    )


def detect_dtmf_digits(wav_path: str) -> str:
    """Detect DTMF digits from a WAV file using dtmf2num."""
    result = subprocess.run(
        ["dtmf2num", wav_path],
        capture_output=True,
        text=True,
        check=False,
    )
    output_lines = result.stdout.strip().split("\n") + result.stderr.strip().split("\n")
    for line in output_lines:
        line = line.strip()
        if "DTMF numbers:" in line:
            parts = line.split(":")
            if len(parts) > 1:
                return parts[1].strip()
    return ""


def save_bytesio_to_file(data: io.BytesIO, file_path: str) -> None:
    """Save BytesIO content to a file."""
    data.seek(0)
    recorded_bytes = data.read()
    with open(file_path, "wb") as f:
        f.write(recorded_bytes)


def record_and_play_through_pipe(
    device_manager: PulseAudioDeviceManager,
    sink_device: OutputDevice,
    monitor_source: InputDevice,
    audio_file_path: str,
    record_duration: float,
    pre_play_delay: float = 1.2,
    post_play_delay: float = 2.0,
) -> io.BytesIO:
    """Record audio from a monitor source while playing to a sink device."""
    recorded_data = io.BytesIO()
    recording_done = threading.Event()
    recording_error = None

    def record_audio():
        nonlocal recording_error
        try:
            device_manager.record(monitor_source, recorded_data, record_duration, raw=False)
        except Exception as e:
            recording_error = e
        finally:
            recording_done.set()

    record_thread = threading.Thread(target=record_audio, daemon=True)
    record_thread.start()
    time.sleep(pre_play_delay)
    with open(audio_file_path, "rb") as audio_file:
        device_manager.play(sink_device, audio_file, raw=False)
    time.sleep(post_play_delay)
    if not recording_done.wait(timeout=record_duration + 1.0):
        raise RuntimeError("Recording did not complete in time")
    record_thread.join(timeout=1.0)
    if recording_error:
        raise recording_error
    return recorded_data


def cleanup_temp_files(*file_paths: str) -> None:
    """Remove temporary files if they exist."""
    for path in file_paths:
        if os.path.exists(path):
            os.unlink(path)


def get_or_create_pipe(device_manager: PulseAudioDeviceManager, pipe_name: str, pipe_type: PipeType):
    """Get an existing pipe or create a new one if it doesn't exist."""
    pipes = device_manager.list_pipes()
    pipe = next((p for p in pipes if p.name == pipe_name), None)
    if not pipe:
        pipe = device_manager.create_pipe(pipe_name, pipe_type)
    return pipe


@pytest.fixture
def device_manager() -> PulseAudioDeviceManager:
    return PulseAudioDeviceManager()


@pytest.fixture
def virtual_sink(device_manager: PulseAudioDeviceManager) -> typing.Generator[str, None, None]:
    pipe = device_manager.create_pipe(f"soundpasta-test_test_sink_{uuid4()}", PipeType.INPUT)
    try:
        yield pipe.name
    finally:
        device_manager.remove_pipe(pipe.name)


@pytest.mark.gui
def test_list_inputs(device_manager: PulseAudioDeviceManager) -> None:
    devices = device_manager.list_inputs()
    assert len(devices) > 0
    for device in devices:
        assert device.name
        assert device.description
        assert device.sample_format
        assert device.channels > 0
        assert device.sample_rate > 0
    alsa_inputs = [d for d in devices if d.name.startswith("alsa_input")]
    assert len(alsa_inputs) > 0


@pytest.mark.gui
def test_list_outputs(device_manager: PulseAudioDeviceManager) -> None:
    devices = device_manager.list_outputs()
    assert len(devices) > 0
    for device in devices:
        assert device.name
        assert device.description
        assert device.sample_format
        assert device.channels > 0
        assert device.sample_rate > 0
    alsa_outputs = [d for d in devices if d.name.startswith("alsa_output")]
    assert len(alsa_outputs) > 0


@pytest.mark.gui
def test_play(device_manager: PulseAudioDeviceManager) -> None:
    outputs = device_manager.list_outputs()
    assert len(outputs) > 0
    output_device = outputs[0]
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        generated_path = tmp_file.name
    try:
        generate_sine_wave_wav(generated_path, frequency=18000, duration=2.0)
        with open(generated_path, "rb") as audio_file:
            audio_data = io.BytesIO(audio_file.read())
        audio_data.seek(0)
        device_manager.play(output_device, audio_data, raw=False)
    finally:
        cleanup_temp_files(generated_path)


@pytest.mark.gui
def test_record(device_manager: PulseAudioDeviceManager) -> None:
    inputs = device_manager.list_inputs()
    assert len(inputs) > 0
    input_device = inputs[0]
    duration = 0.5
    audio_data = io.BytesIO()
    device_manager.record(input_device, audio_data, duration, raw=False)
    audio_data.seek(0)
    recorded_bytes = audio_data.read()
    assert len(recorded_bytes) > 0
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        recorded_path = tmp_file.name
    try:
        save_bytesio_to_file(audio_data, recorded_path)
        data, sample_rate = soundfile.read(recorded_path)
        assert len(data) >= 0
        assert sample_rate > 0
        if len(data) > 0:
            max_amplitude = numpy.max(numpy.abs(data))
            assert max_amplitude >= 0
            assert max_amplitude <= 1.0
    finally:
        cleanup_temp_files(recorded_path)


@pytest.mark.gui
def test_dtmf_detection() -> None:
    test_digits = "147"
    tone_duration = 0.3
    with tempfile.TemporaryDirectory() as tmpdir:
        for digit in test_digits:
            wav_path = os.path.join(tmpdir, f"digit_{digit}.wav")
            generate_dtmf_tone_wav(wav_path, digit, tone_duration)
            mono_path = os.path.join(tmpdir, f"digit_{digit}_mono.wav")
            convert_wav_to_mono_8khz(wav_path, mono_path)
            detected_digit = detect_dtmf_digits(mono_path)
            assert detected_digit == digit, f"Expected {digit}, got {detected_digit}"


@pytest.mark.gui
def test_sine_wave_pipe(device_manager: PulseAudioDeviceManager, virtual_sink: str) -> None:
    sample_rate = 44100
    frequency = 18000
    duration = 1.0
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as generated_file:
        generated_path = generated_file.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as recorded_file:
        recorded_path = recorded_file.name
    try:
        generate_sine_wave_wav(generated_path, frequency, duration, sample_rate)
        pipe = get_or_create_pipe(device_manager, virtual_sink, PipeType.INPUT)
        virtual_sink_device = pipe.sink
        monitor_source = pipe.monitor
        record_duration = duration + 2.0
        recorded_data = record_and_play_through_pipe(
            device_manager,
            virtual_sink_device,
            monitor_source,
            generated_path,
            record_duration,
            pre_play_delay=1.0,
            post_play_delay=1.0,
        )
        recorded_data.seek(0)
        assert len(recorded_data.read()) > 0, "Recorded audio is empty"
        save_bytesio_to_file(recorded_data, recorded_path)
        data, sr = soundfile.read(recorded_path)
        assert len(data) > 0, "Recorded data is empty"
        assert sr == sample_rate, f"Expected sample rate {sample_rate}, got {sr}"
        if len(data.shape) > 1:
            data = data[:, 0]
        max_amplitude = numpy.max(numpy.abs(data))
        assert max_amplitude > 0.01, f"Recorded signal too quiet: max amplitude {max_amplitude}"
        fft = numpy.fft.fft(data)
        freqs = numpy.fft.fftfreq(len(data), 1 / sr)
        magnitude = numpy.abs(fft)
        peak_freq_idx = numpy.argmax(magnitude[: len(magnitude) // 2])
        peak_freq = abs(freqs[peak_freq_idx])
        assert abs(peak_freq - frequency) < 500, f"Expected frequency around {frequency}Hz, got {peak_freq}Hz"
    finally:
        cleanup_temp_files(generated_path, recorded_path)


@pytest.mark.gui
def test_dtmf_single_digit_pipe(device_manager: PulseAudioDeviceManager, virtual_sink: str) -> None:
    test_digit = "1"
    tone_duration = 0.3
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as generated_file:
        generated_path = generated_file.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as recorded_file:
        recorded_path = recorded_file.name
    try:
        generate_dtmf_tone_wav(generated_path, test_digit, tone_duration)
        pipe = get_or_create_pipe(device_manager, virtual_sink, PipeType.INPUT)
        virtual_sink_device = pipe.sink
        monitor_source = pipe.monitor
        record_duration = tone_duration + 3.5
        recorded_data = record_and_play_through_pipe(
            device_manager,
            virtual_sink_device,
            monitor_source,
            generated_path,
            record_duration,
            pre_play_delay=1.2,
            post_play_delay=2.0,
        )
        recorded_data.seek(0)
        assert len(recorded_data.read()) > 0, "Recorded audio is empty"
        save_bytesio_to_file(recorded_data, recorded_path)
        mono_recorded_path = f"{recorded_path}.mono.wav"
        convert_wav_to_mono_8khz(recorded_path, mono_recorded_path)
        detected_digit = detect_dtmf_digits(mono_recorded_path)
        assert detected_digit == test_digit, f"Expected {test_digit}, got {detected_digit}"
        cleanup_temp_files(mono_recorded_path)
    finally:
        cleanup_temp_files(generated_path, recorded_path)


@pytest.mark.gui
def test_dtmf_pipe(device_manager: PulseAudioDeviceManager, virtual_sink: str) -> None:
    test_digits = "147"
    tone_duration = 0.3
    pause_duration = 0.5
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as generated_file:
        generated_path = generated_file.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as recorded_file:
        recorded_path = recorded_file.name
    try:
        generate_dtmf_sequence_wav(generated_path, test_digits, tone_duration, pause_duration)
        pipe = get_or_create_pipe(device_manager, virtual_sink, PipeType.INPUT)
        virtual_sink_device = pipe.sink
        monitor_source = pipe.monitor
        audio_duration = len(test_digits) * (tone_duration + pause_duration) - pause_duration
        record_duration = audio_duration + 3.5
        recorded_data = record_and_play_through_pipe(
            device_manager,
            virtual_sink_device,
            monitor_source,
            generated_path,
            record_duration,
            pre_play_delay=1.2,
            post_play_delay=2.0,
        )
        recorded_data.seek(0)
        assert len(recorded_data.read()) > 0, "Recorded audio is empty"
        save_bytesio_to_file(recorded_data, recorded_path)
        mono_recorded_path = f"{recorded_path}.mono.wav"
        convert_wav_to_mono_8khz(recorded_path, mono_recorded_path)
        detected_digits = detect_dtmf_digits(mono_recorded_path)
        assert detected_digits == test_digits, f"Expected {test_digits}, got {detected_digits}"
        cleanup_temp_files(mono_recorded_path)
    finally:
        cleanup_temp_files(generated_path, recorded_path)
