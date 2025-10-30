#!/bin/bash

# Script to enable GPT prompt debugging
# This sets the environment variable and starts the server with debug logging

echo "🔧 Enabling GPT prompt debugging..."
echo "This will show detailed GPT prompts and responses in the terminal."
echo ""

# Set the environment variable for GPT debugging
export ENABLE_GPT_DEBUG=true

echo "✅ ENABLE_GPT_DEBUG environment variable set to: $ENABLE_GPT_DEBUG"
echo ""
echo "🚀 Starting server with GPT debug logging enabled..."
echo "You should now see detailed GPT debug information in the terminal when GPT makes moves."
echo ""

# Start the server
npm run dev
