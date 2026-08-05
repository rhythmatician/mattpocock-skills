# When to Mock

Use the smallest test double that gives confidence. Prefer the real thing, then a fake, then a stub, then a spy, and use a mock only when the behavior truly depends on an interaction contract.

## Preference order

1. **Real thing**
2. **Fake**
3. **Stub**
4. **Spy**
5. **Mock**

## The test-double taxonomy

- **Dummy**: passed around but never used; it only exists to satisfy a parameter list.
- **Fake**: a working implementation with a shortcut, such as an in-memory repository.
- **Stub**: returns canned answers and usually ignores its inputs.
- **Spy**: records how it was called while still providing behavior.
- **Mock**: pre-programmed with expectations about how and when it should be called.

## Hidden dependencies matter

Time, randomness, environment variables, and databases are not free. They are hidden inputs and outputs. When they leak into the code, tests become flaky and harder to isolate.

Prefer explicit dependencies over ambient state:

```python
def create_user(name, clock, id_generator, repo):
    user = User(name=name, created_at=clock.now(), id=id_generator.generate())
    repo.save(user)
    return user
```

That is easier to reason about than reaching into the system clock or a global repository implicitly.

## Good use cases

Mock at system boundaries only:

- external APIs and network services
- databases when the real database would make tests slow or flaky
- time and randomness
- file system access in some cases

Do not mock:

- your own classes or modules
- internal collaborators
- anything you control directly

## Design for testability

At system boundaries, design interfaces that are easy to substitute:

```python
class PaymentGateway:
    def charge(self, amount: int) -> str:
        raise NotImplementedError


def process_payment(order, payment_gateway):
    return payment_gateway.charge(order.total)
```

This is easier to test than a function that creates a concrete client internally and reaches out to the real network.

## Prefer fakes over mocks

A fake is often the best substitute because it preserves real behavior without the cost of the real dependency.

```python
class InMemoryUserRepository:
    def __init__(self):
        self._users = {}

    def save(self, user):
        self._users[user.id] = user

    def get_by_id(self, user_id):
        return self._users.get(user_id)
```

Then the test can verify the outcome directly:

```python
def test_user_can_be_retrieved_after_registration():
    repo = InMemoryUserRepository()
    service = UserService(repo)

    user = service.create_user("Alice")
    retrieved = service.get_user(user.id)

    assert retrieved.name == "Alice"
```

## When mocks are appropriate

Use a mock only when you need to verify a specific interaction contract that is part of the behavior under test. Even then, prefer a simple spy or a lightweight fake when possible.

If you find yourself asserting that `repo.save()` was called exactly once, ask whether the real behavior is that the user can later be retrieved or that the operation succeeds. Test that behavior instead.
