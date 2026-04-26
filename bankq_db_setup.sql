-- ============================================
-- BANKQ DATABASE SETUP SCRIPT
-- Run this in MySQL Workbench to create
-- the database and all required tables
-- ============================================

-- Step 1: Create the database
CREATE DATABASE IF NOT EXISTS bankq_db;

-- Step 2: Use the database
USE bankq_db;

-- ============================================
-- TABLE 1: users
-- Stores registered user accounts
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE 2: otp_tokens
-- Stores OTP codes for email verification
-- ============================================
CREATE TABLE IF NOT EXISTS otp_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(150) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE 3: sessions
-- Stores active login sessions
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- VERIFY: Show all tables created
-- ============================================
SHOW TABLES;

-- ============================================
-- VERIFY: Show table structures
-- ============================================
DESCRIBE users;
DESCRIBE otp_tokens;
DESCRIBE sessions;

-- ============================================
-- Done! All 3 tables are ready.
-- ============================================
