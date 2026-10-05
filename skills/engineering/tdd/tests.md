# Good and Bad Tests

## Good tests

**Behavior-focused**: test through the public seam that matters to a caller.

```python
def test_user_can_register_and_be_retrieved():
    user = create_user(name="Alice", email="alice@example.com")
    retrieved = get_user(user.id)

    assert retrieved.email == "alice@example.com"
```

Characteristics:

- tests behavior a caller cares about
- uses the public interface
- survives internal refactors
- describes what the system does, not how it does it
- keeps each test focused on one behavior

## Bad tests: implementation-coupled

```python
def test_create_user_calls_repo_save_once(mocker):
    repo = mocker.Mock()
    service = UserService(repo)

    service.create_user("Alice")

    repo.save.assert_called_once()
```

This is weak because it asserts on an internal interaction rather than the real outcome. A user cares that the account exists and can be retrieved later, not that one method was called.

Red flags:

- mocking internal collaborators
- testing private methods
- asserting on call counts or call order
- making the test break after a harmless refactor
- naming the test around implementation instead of behavior

## Bad tests: tautological

```python
def test_calculate_total_sums_line_items():
    items = [{"price": 10}, {"price": 5}]
    expected = sum(item["price"] for item in items)

    assert calculate_total(items) == expected
```

This passes by construction because the expected value reproduces the implementation.

A better version uses an independent, known literal:

```python
def test_calculate_total_sums_line_items():
    assert calculate_total([{"price": 10}, {"price": 5}]) == 15
```

## Good negative or boundary tests

```python
import pytest


def test_duplicate_email_is_rejected():
    create_user(name="Alice", email="same@example.com")

    with pytest.raises(DuplicateEmailError):
        create_user(name="Bob", email="same@example.com")
```

This is often more valuable than asserting on repository internals or log messages because it protects the business rule directly.

## When the test is hard to write

If a test needs a pile of mocks, monkeypatches, or a real database just to exercise a tiny rule, treat that as design feedback. The code may be mixing responsibilities or hiding too much state.

A better shape is often:

- keep the transport layer thin,
- put the rule in a service or domain layer,
- inject the dependency that would otherwise be hidden.

That usually makes the behavior easier to test and the code easier to reason about.
