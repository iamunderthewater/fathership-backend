import mongoose from "mongoose";

const banSchema = mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    }
})

export default mongoose.model("banned_users", banSchema);