import logging

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    # datefmt="%Y-%m-%d %H:%M:%S.%f",
)


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "gui: mark test as needing a real computer to run on"
    )
