// Load the converted MNN model, run the deterministic input saved by make_ref.py,
// and compare with the ONNX reference output.
#include <MNN/Interpreter.hpp>
#include <MNN/Tensor.hpp>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

static std::vector<float> readBin(const char* path, size_t n) {
    std::vector<float> v(n);
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(1); }
    if (fread(v.data(), sizeof(float), n, f) != n) {
        fprintf(stderr, "short read %s\n", path); exit(1);
    }
    fclose(f);
    return v;
}

int main(int argc, char** argv) {
    const char* model = argc > 1 ? argv[1] : "public/models/lama.mnn";
    const char* ref = argc > 2 ? argv[2] : "tools/.work/ref";
    const int size = argc > 3 ? atoi(argv[3]) : 512;
    const int N = 1, C = 4, H = size, W = size;
    const size_t inN = (size_t)N * C * H * W;
    const size_t outN = (size_t)N * 3 * H * W;

    std::string ip = std::string(ref) + "/input.bin";
    std::string op = std::string(ref) + "/onnx.bin";
    auto input = readBin(ip.c_str(), inN);
    auto refOut = readBin(op.c_str(), outN);

    std::shared_ptr<MNN::Interpreter> net(MNN::Interpreter::createFromFile(model));
    if (!net) { fprintf(stderr, "load failed\n"); return 1; }
    MNN::BackendConfig bc;
    bc.precision = MNN::BackendConfig::Precision_High;
    bc.power = MNN::BackendConfig::Power_High;
    MNN::ScheduleConfig cfg;
    cfg.type = MNN_FORWARD_CPU;
    cfg.numThread = 8;
    cfg.backendConfig = &bc;
    MNN::Session* sess = net->createSession(cfg);
    if (!sess) { fprintf(stderr, "session failed\n"); return 1; }

    MNN::Tensor* in = net->getSessionInput(sess, "image_mask");
    if (!in) { fprintf(stderr, "missing input image_mask\n"); return 1; }
    printf("input dims:");
    for (int i = 0; i < in->dimensions(); ++i) printf(" %d", in->length(i));
    printf("\n");
    MNN::Tensor* host = MNN::Tensor::create<float>({1, 4, size, size},
                                                    input.data(),
                                                    MNN::Tensor::CAFFE);
    if (!in->copyFromHostTensor(host)) { fprintf(stderr, "copy input failed\n"); return 1; }
    MNN::Tensor::destroy(host);
    auto code = net->runSession(sess);
    if (code != MNN::NO_ERROR) { fprintf(stderr, "run failed %d\n", (int)code); return 1; }
    MNN::Tensor* out = net->getSessionOutput(sess, "inpainted");
    if (!out) { fprintf(stderr, "missing output inpainted\n"); return 1; }
    MNN::Tensor* hostOut = MNN::Tensor::createHostTensorFromDevice(out, true);
    std::vector<float> got(outN);
    for (size_t i = 0; i < outN; ++i) got[i] = hostOut->host<float>()[i];
    MNN::Tensor::destroy(hostOut);

    double maxe = 0, sum = 0, corrA = 0, corrB = 0, corrAB = 0;
    double ma = 0, mb = 0;
    for (size_t i = 0; i < outN; ++i) {
        double d = std::fabs(got[i] - refOut[i]);
        maxe = std::max(maxe, d); sum += d;
        ma += refOut[i]; mb += got[i];
    }
    ma /= outN; mb /= outN;
    for (size_t i = 0; i < outN; ++i) {
        double a = refOut[i] - ma, b = got[i] - mb;
        corrA += a * a; corrB += b * b; corrAB += a * b;
    }
    printf("elements %zu  max_abs_err %.6g  mean_abs_err %.6g  corr %.9f\n",
           outN, maxe, sum / outN, corrAB / std::sqrt(corrA * corrB));
    double omin = 1e9, omax = -1e9, mmin = 1e9, mmax = -1e9, mvar = 0, ovar = 0;
    for (size_t i = 0; i < outN; ++i) {
        omin = std::min(omin, (double)refOut[i]); omax = std::max(omax, (double)refOut[i]);
        mmin = std::min(mmin, (double)got[i]);    mmax = std::max(mmax, (double)got[i]);
        double da = refOut[i] - ma, db = got[i] - mb;
        ovar += da * da; mvar += db * db;
    }
    printf("onnx range [%.6f, %.6f] std %.6f  mnn range [%.6f, %.6f] std %.6f\n",
           omin, omax, std::sqrt(ovar / outN), mmin, mmax, std::sqrt(mvar / outN));
    FILE* f = fopen((std::string(ref) + "/mnn.bin").c_str(), "wb");
    if (f) { fwrite(got.data(), sizeof(float), outN, f); fclose(f); }
    net->releaseSession(sess);
    return maxe < 2e-3 ? 0 : 2;
}
