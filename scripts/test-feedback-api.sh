#!/bin/bash

# Enhanced Test script for Feedback API
# Automatically fetches config from SSM and prompts for credentials

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Feedback API Test Script"
echo "=========================================="
echo ""

# Get stack name from config.yaml or use default
STACK_NAME="genaiid-agentcore-starter-pack"
if [ -f "infra-cdk/config.yaml" ]; then
    STACK_NAME=$(grep "stack_name_base:" infra-cdk/config.yaml | awk '{print $2}' | tr -d '"')
fi

echo "Using stack: $STACK_NAME"
echo ""

# Fetch configuration from SSM
echo "Fetching configuration from SSM..."

USER_POOL_ID=$(aws ssm get-parameter \
    --name "/${STACK_NAME}/cognito-user-pool-id" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null)

CLIENT_ID=$(aws ssm get-parameter \
    --name "/${STACK_NAME}/cognito-user-pool-client-id" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null)

API_URL=$(aws ssm get-parameter \
    --name "/${STACK_NAME}/feedback-api-url" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null)

if [ -z "$USER_POOL_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$API_URL" ]; then
    echo -e "${RED}Error: Could not fetch configuration from SSM.${NC}"
    echo "Make sure the stack is deployed and you have AWS credentials configured."
    exit 1
fi

echo -e "${GREEN}✓ Configuration fetched successfully${NC}"
echo "  User Pool ID: $USER_POOL_ID"
echo "  Client ID: $CLIENT_ID"
echo "  API URL: $API_URL"
echo ""

# Prompt for credentials
echo "=========================================="
echo "Authentication"
echo "=========================================="
echo ""

read -p "Enter username (default: testuser): " USERNAME
USERNAME=${USERNAME:-testuser}

# Check if user exists
USER_EXISTS=$(aws cognito-idp admin-get-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" 2>/dev/null && echo "yes" || echo "no")

if [ "$USER_EXISTS" = "no" ]; then
    echo -e "${YELLOW}User '$USERNAME' does not exist.${NC}"
    read -p "Would you like to create this user? (y/n): " CREATE_USER
    
    if [ "$CREATE_USER" = "y" ] || [ "$CREATE_USER" = "Y" ]; then
        read -s -p "Enter password for new user: " NEW_PASSWORD
        echo ""
        read -s -p "Confirm password: " CONFIRM_PASSWORD
        echo ""
        
        if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
            echo -e "${RED}Passwords do not match. Exiting.${NC}"
            exit 1
        fi
        
        echo "Creating user..."
        aws cognito-idp admin-create-user \
            --user-pool-id "$USER_POOL_ID" \
            --username "$USERNAME" \
            --temporary-password "TempPass123!" \
            --message-action SUPPRESS > /dev/null
        
        aws cognito-idp admin-set-user-password \
            --user-pool-id "$USER_POOL_ID" \
            --username "$USERNAME" \
            --password "$NEW_PASSWORD" \
            --permanent > /dev/null
        
        echo -e "${GREEN}✓ User created successfully${NC}"
        PASSWORD="$NEW_PASSWORD"
    else
        echo "Exiting."
        exit 0
    fi
else
    read -s -p "Enter password for $USERNAME: " PASSWORD
    echo ""
fi

# Authenticate and get token
echo ""
echo "Authenticating..."

AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$CLIENT_ID" \
    --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Authentication failed:${NC}"
    echo "$AUTH_RESPONSE"
    exit 1
fi

COGNITO_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.IdToken')

if [ -z "$COGNITO_TOKEN" ] || [ "$COGNITO_TOKEN" = "null" ]; then
    echo -e "${RED}Failed to get authentication token${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Authentication successful${NC}"
echo ""

# Remove trailing slash from API_URL if present
API_URL="${API_URL%/}"

# Run tests
echo "=========================================="
echo "Running Tests"
echo "=========================================="
echo ""

PASSED=0
FAILED=0

# Test 1: Thumbs up feedback
echo "Test 1: Sending thumbs up feedback..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/feedback" \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-123",
    "message": "This is a great AI response about AWS services",
    "isThumbsUp": true
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✓ Test 1 passed (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    ((PASSED++))
else
    echo -e "${RED}✗ Test 1 failed (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    ((FAILED++))
fi
echo ""

# Test 2: Thumbs down feedback
echo "Test 2: Sending thumbs down feedback..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/feedback" \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-456",
    "message": "This response was not helpful for pricing questions",
    "isThumbsUp": false
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✓ Test 2 passed (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    ((PASSED++))
else
    echo -e "${RED}✗ Test 2 failed (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    ((FAILED++))
fi
echo ""

# Test 3: Missing required field (should fail)
echo "Test 3: Testing missing required field (should fail with 400)..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/feedback" \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-999"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${GREEN}✓ Test 3 passed (HTTP $HTTP_CODE - correctly rejected missing fields)${NC}"
    echo "  Response: $BODY"
    ((PASSED++))
else
    echo -e "${RED}✗ Test 3 failed (HTTP $HTTP_CODE - should have been 400)${NC}"
    echo "  Response: $BODY"
    ((FAILED++))
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
