# Build stage
FROM osimis/orthanc:21.11.0 AS build

# Update OS packages
RUN apt-get -y update

# Install Orthanc S3 plugin build dependencies
RUN apt-get install -y git mercurial build-essential unzip cmake libcrypto++-dev wget

# Clone Orthanc S3 pluging source code
WORKDIR /tmp
RUN hg clone https://hg.orthanc-server.com/orthanc-object-storage/ -b default

# Create Makefile with CMake
WORKDIR /tmp/build
RUN cmake -DSTATIC_BUILD=ON -DCMAKE_BUILD_TYPE=Release -DUSE_VCPKG_PACKAGES=OFF -DUSE_SYSTEM_GOOGLE_TEST=OFF ../orthanc-object-storage/Aws

# Build with make and all available cores
RUN CORES=`grep -c ^processor /proc/cpuinfo` && make -j$CORES

# Release stage
FROM osimis/orthanc:21.11.0 AS release

# Copy S3 plugin compiled shared library from build stage
COPY --from=build /tmp/build/libOrthancAwsS3Storage.so /usr/share/orthanc/plugins/

# Update OS packages
RUN apt-get -y update 
RUN DEBIAN_FRONTEND=noninteractive apt-get -y upgrade

# Create non-root Orthanc user and group
RUN groupadd -r orthanc -g 433 && \
    useradd -u 431 -r -g orthanc -c "Orthanc user" orthanc
RUN chmod -R 755 /usr/share/orthanc
RUN chown -R orthanc /usr/share/orthanc
