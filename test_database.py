import pytest
import hashlib
import os
from database import verify_password

def test_verify_password_legacy_sha256():
    password = "my_secure_password"
    # Create a legacy hash (just sha256 hex)
    legacy_hash = hashlib.sha256(password.encode()).hexdigest()

    # Should be True for correct password
    assert verify_password(password, legacy_hash) is True

    # Should be False for incorrect password
    assert verify_password("wrong_password", legacy_hash) is False

def test_verify_password_pbkdf2():
    password = "my_secure_password"
    # Create a PBKDF2 hash manually
    salt = os.urandom(16)
    actual_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100_000)
    hashed_str = f"{salt.hex()}:{actual_hash.hex()}"

    # Should be True for correct password
    assert verify_password(password, hashed_str) is True

    # Should be False for incorrect password
    assert verify_password("wrong_password", hashed_str) is False

def test_verify_password_malformed_hash_with_colon():
    password = "my_secure_password"

    # Contains colon but invalid hex
    assert verify_password(password, "invalidhex:invalidhex") is False

    # Only a colon
    assert verify_password(password, ":") is False

    # Multiple colons
    assert verify_password(password, "a:b:c") is False

def test_verify_password_invalid_types():
    # Sending None should raise exception inside and return False
    assert verify_password(None, "hash") is False
    assert verify_password("password", None) is False
